import { isIP } from "node:net";
import { getPool } from "@/lib/db";

const USER_AGENT = "ArborLineResearch/1.0 (+https://www.arborlineconnect.com)";
const MAX_PAGES = 7;
const MAX_PAGE_BYTES = 750_000;
const FETCH_TIMEOUT_MS = 10_000;
const GENERIC_EMAIL_LOCAL_PARTS = new Set([
  "admin", "billing", "careers", "contact", "hello", "hr", "info", "jobs", "marketing",
  "office", "sales", "service", "support", "team"
]);

export type PublicResearchCandidate = {
  name: string | null;
  title: string | null;
  decisionMakerConfidence: number;
  publishedEmail: string | null;
  emailConfidence: number;
  inferredEmailCandidates: string[];
  sourceUrl: string | null;
  evidence: string[];
};

export type PublicResearchResult = {
  status: "CANDIDATE_FOUND" | "NO_MATCH" | "BLOCKED" | "ERROR";
  domain: string;
  candidate: PublicResearchCandidate | null;
  publishedEmails: string[];
  pagesChecked: string[];
  robotsRespected: boolean;
  error?: string;
};

type PageSnapshot = {
  url: string;
  text: string;
  html: string;
};

function normalizeDomain(value: string | null | undefined) {
  const clean = (value ?? "").trim().toLowerCase();
  if (!clean) return "";
  return clean
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split(":")[0];
}

function validPublicDomain(domain: string) {
  if (!domain || domain === "localhost" || domain.endsWith(".local") || isIP(domain)) return false;
  return /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain);
}

function normalizeHost(value: string) {
  return value.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

function hostAllowed(hostname: string, domain: string) {
  const host = normalizeHost(hostname);
  const expected = normalizeHost(domain);
  return host === expected || host.endsWith(`.${expected}`);
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function htmlToText(html: string) {
  return decodeHtml(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\r/g, "")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleMatches(line: string, approvedTitles: string[]) {
  const target = normalizeTitle(line);
  if (!target) return null;

  for (const rawTitle of approvedTitles) {
    const expected = normalizeTitle(rawTitle);
    if (!expected) continue;

    if (expected === "president") {
      if (/\bpresident\b/.test(target) && !/\bvice president\b/.test(target)) return rawTitle;
      continue;
    }
    if (expected === "ceo") {
      if (/\bceo\b/.test(target) || target.includes("chief executive officer")) return rawTitle;
      continue;
    }
    if (expected === "coo" || expected === "chief operating officer") {
      if (/\bcoo\b/.test(target) || target.includes("chief operating officer")) return rawTitle;
      continue;
    }
    if (expected === "vp sales" || expected === "vice president of sales") {
      if (/\b(vp|vice president)\b/.test(target) && /\bsales\b/.test(target)) return rawTitle;
      continue;
    }
    if (target.includes(expected)) return rawTitle;
  }
  return null;
}

function cleanName(value: string) {
  return value
    .replace(/\s*[|•·–—,:]+\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikePersonName(value: string) {
  const name = cleanName(value);
  if (name.length < 4 || name.length > 70) return false;
  const words = name.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  if (words.some((word) => /\d|@|https?|www\./i.test(word))) return false;
  const banned = /\b(team|leadership|management|contact|about|services|company|landscape|landscaping|hvac|cleaning|staffing|director|manager|president|owner|founder|chief|officer|sales|operations)\b/i;
  if (banned.test(name)) return false;
  return words.every((word) => /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ.'’-]*$/.test(word));
}

function extractEmails(html: string, domain: string) {
  const decoded = decodeHtml(html);
  const matches = decoded.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return [...new Set(matches.map((email) => email.toLowerCase()))]
    .filter((email) => hostAllowed(email.split("@")[1] ?? "", domain));
}

function personalEmails(emails: string[]) {
  return emails.filter((email) => {
    const local = email.split("@")[0]?.toLowerCase() ?? "";
    return local && !GENERIC_EMAIL_LOCAL_PARTS.has(local) && !local.startsWith("no-reply") && !local.startsWith("noreply");
  });
}

function normalizeNameToken(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function emailLooksLikeName(email: string, name: string) {
  const local = normalizeNameToken(email.split("@")[0] ?? "");
  const parts = name.split(/\s+/).map(normalizeNameToken).filter(Boolean);
  if (parts.length < 2 || !local) return false;
  const first = parts[0];
  const last = parts[parts.length - 1];
  return local.includes(last) && (local.includes(first) || local.startsWith(first[0] ?? ""));
}

function inferredEmails(name: string | null, domain: string) {
  if (!name) return [];
  const parts = name.split(/\s+/).map(normalizeNameToken).filter(Boolean);
  if (parts.length < 2) return [];
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (!first || !last) return [];
  return [...new Set([
    `${first}.${last}@${domain}`,
    `${first[0]}${last}@${domain}`,
    `${first}${last}@${domain}`,
    `${first}@${domain}`
  ])];
}

function extractSameDomainLinks(html: string, baseUrl: string, domain: string) {
  const links: string[] = [];
  const pattern = /href\s*=\s*["']([^"'#]+)["']/gi;
  for (const match of html.matchAll(pattern)) {
    const href = match[1]?.trim();
    if (!href || /^mailto:|^tel:|^javascript:/i.test(href)) continue;
    try {
      const url = new URL(href, baseUrl);
      if (!/^https?:$/.test(url.protocol) || !hostAllowed(url.hostname, domain)) continue;
      const path = url.pathname.toLowerCase();
      if (!/(about|team|leadership|staff|management|people|contact|company)/.test(path)) continue;
      url.hash = "";
      url.search = "";
      links.push(url.toString());
    } catch {}
  }
  return [...new Set(links)];
}

function parseRobots(text: string) {
  const disallow: string[] = [];
  let applies = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const splitAt = line.indexOf(":");
    if (splitAt < 0) continue;
    const key = line.slice(0, splitAt).trim().toLowerCase();
    const value = line.slice(splitAt + 1).trim();
    if (key === "user-agent") {
      applies = value === "*" || value.toLowerCase() === "arborlineresearch";
      continue;
    }
    if (key === "disallow" && applies && value) disallow.push(value);
  }
  return disallow;
}

async function fetchText(url: string, domain: string, maxRedirects = 3): Promise<{ url: string; text: string; contentType: string } | null> {
  let current = new URL(url);
  for (let redirect = 0; redirect <= maxRedirects; redirect++) {
    if (!/^https?:$/.test(current.protocol) || !hostAllowed(current.hostname, domain) || isIP(current.hostname)) return null;

    const response = await fetch(current, {
      redirect: "manual",
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,text/plain;q=0.9,*/*;q=0.1"
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) return null;
      const next = new URL(location, current);
      if (!hostAllowed(next.hostname, domain) || isIP(next.hostname)) return null;
      current = next;
      continue;
    }

    if (!response.ok) return null;
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_PAGE_BYTES) return null;
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const text = (await response.text()).slice(0, MAX_PAGE_BYTES);
    return { url: current.toString(), text, contentType };
  }
  return null;
}

function robotsAllows(pathname: string, disallow: string[]) {
  return !disallow.some((rule) => rule !== "/" && pathname.startsWith(rule)) && !disallow.includes("/");
}

function candidateFromPages(pages: PageSnapshot[], domain: string, approvedTitles: string[]): PublicResearchCandidate | null {
  let best: PublicResearchCandidate | null = null;

  for (const page of pages) {
    const lines = page.text.split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 5000);
    const pageEmails = personalEmails(extractEmails(page.html, domain));

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const matchedTitle = titleMatches(line, approvedTitles);
      if (!matchedTitle) continue;

      const normalizedMatchedTitle = normalizeTitle(matchedTitle);
      const sameLineWithoutTitle = cleanName(
        normalizeTitle(line).includes(normalizedMatchedTitle)
          ? line.replace(new RegExp(matchedTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ")
          : line
      );

      const nearby = [sameLineWithoutTitle, lines[index - 2], lines[index - 1], lines[index + 1], lines[index + 2]]
        .filter((value): value is string => Boolean(value));
      const name = nearby.map(cleanName).find(looksLikePersonName) ?? null;
      if (!name) continue;

      const nameEmail = pageEmails.find((email) => emailLooksLikeName(email, name)) ?? null;
      const publishedEmail = nameEmail ?? (pageEmails.length === 1 ? pageEmails[0] : null);
      let decisionMakerConfidence = 78;
      if (/team|leadership|people|management|about/.test(new URL(page.url).pathname.toLowerCase())) decisionMakerConfidence += 7;
      if (publishedEmail && nameEmail) decisionMakerConfidence += 8;
      decisionMakerConfidence = Math.min(98, decisionMakerConfidence);

      let emailConfidence = 0;
      if (publishedEmail) emailConfidence = nameEmail ? 94 : 72;

      const evidence = [
        `${name} appears with an approved decision-maker title (${matchedTitle}) on ${new URL(page.url).pathname || "/"}.`,
        publishedEmail
          ? `${publishedEmail} is publicly listed on the company domain${nameEmail ? " and matches the decision-maker name pattern" : ""}.`
          : "No direct decision-maker email was published on the checked pages."
      ];

      const candidate: PublicResearchCandidate = {
        name,
        title: matchedTitle,
        decisionMakerConfidence,
        publishedEmail,
        emailConfidence,
        inferredEmailCandidates: publishedEmail ? [] : inferredEmails(name, domain),
        sourceUrl: page.url,
        evidence
      };

      if (!best || candidate.decisionMakerConfidence + candidate.emailConfidence > best.decisionMakerConfidence + best.emailConfidence) {
        best = candidate;
      }
    }
  }

  return best;
}

export function publicResearchEnabled() {
  return process.env.CONNECT_PUBLIC_RESEARCH_ENABLED !== "false";
}

export async function researchPublicCompanySite(domainValue: string, approvedTitles: string[]): Promise<PublicResearchResult> {
  const domain = normalizeDomain(domainValue);
  if (!publicResearchEnabled()) {
    return { status: "BLOCKED", domain, candidate: null, publishedEmails: [], pagesChecked: [], robotsRespected: true, error: "Public research is disabled." };
  }
  if (!validPublicDomain(domain)) {
    return { status: "BLOCKED", domain, candidate: null, publishedEmails: [], pagesChecked: [], robotsRespected: true, error: "Invalid or non-public domain." };
  }

  try {
    let robotsDisallow: string[] = [];
    try {
      const robots = await fetchText(`https://${domain}/robots.txt`, domain);
      if (robots) robotsDisallow = parseRobots(robots.text);
    } catch {}

    if (robotsDisallow.includes("/")) {
      return { status: "BLOCKED", domain, candidate: null, publishedEmails: [], pagesChecked: [], robotsRespected: true, error: "robots.txt disallows crawling." };
    }

    const queue = [
      `https://${domain}/`,
      `https://${domain}/about`,
      `https://${domain}/about-us`,
      `https://${domain}/team`,
      `https://${domain}/our-team`,
      `https://${domain}/leadership`,
      `https://${domain}/contact`
    ];
    const visited = new Set<string>();
    const pages: PageSnapshot[] = [];

    while (queue.length && pages.length < MAX_PAGES) {
      const next = queue.shift();
      if (!next) break;
      let parsed: URL;
      try { parsed = new URL(next); } catch { continue; }
      if (!robotsAllows(parsed.pathname || "/", robotsDisallow)) continue;
      const key = `${parsed.protocol}//${normalizeHost(parsed.hostname)}${parsed.pathname}`.replace(/\/$/, "") || domain;
      if (visited.has(key)) continue;
      visited.add(key);

      let fetched: { url: string; text: string; contentType: string } | null = null;
      try { fetched = await fetchText(next, domain); } catch { continue; }
      if (!fetched || (fetched.contentType && !fetched.contentType.includes("text/html") && !fetched.contentType.includes("text/plain"))) continue;

      const html = fetched.text;
      const text = htmlToText(html);
      pages.push({ url: fetched.url, html, text });

      if (pages.length === 1) {
        for (const discovered of extractSameDomainLinks(html, fetched.url, domain).slice(0, 8)) queue.push(discovered);
      }
    }

    const publishedEmails = [...new Set(pages.flatMap((page) => extractEmails(page.html, domain)))];
    const candidate = candidateFromPages(pages, domain, approvedTitles);
    return {
      status: candidate ? "CANDIDATE_FOUND" : "NO_MATCH",
      domain,
      candidate,
      publishedEmails,
      pagesChecked: pages.map((page) => page.url),
      robotsRespected: true
    };
  } catch (error) {
    return {
      status: "ERROR",
      domain,
      candidate: null,
      publishedEmails: [],
      pagesChecked: [],
      robotsRespected: true,
      error: error instanceof Error ? error.message.slice(0, 500) : "Unknown public research error"
    };
  }
}

export async function researchQualifiedProspects(clientId: string, limit = 10, segmentId?: string | null) {
  const pool = getPool();
  const profile = segmentId
    ? await pool.query(
      `SELECT decision_maker_titles FROM connect_prospect_segments
       WHERE id=$1 AND client_id=$2 AND status IN ('APPROVED','ACTIVE') LIMIT 1`,
      [segmentId, clientId]
    )
    : await pool.query(`SELECT decision_maker_titles FROM connect_icp_profiles WHERE client_id=$1 LIMIT 1`, [clientId]);

  const titles = Array.isArray(profile.rows[0]?.decision_maker_titles)
    ? profile.rows[0].decision_maker_titles.map(String).map((value: string) => value.trim()).filter(Boolean)
    : [];
  if (!titles.length) throw new Error(segmentId ? "Prospect segment has no approved decision-maker titles." : "Client ICP has no decision-maker titles.");

  const safeLimit = Math.max(1, Math.min(20, Math.floor(limit || 10)));
  const { rows } = await pool.query(
    `SELECT id,domain,company_name,contact_name,contact_title
     FROM connect_prospects
     WHERE client_id=$1
       AND (($3::uuid IS NULL AND segment_id IS NULL) OR segment_id=$3)
       AND qualification_status='QUALIFIED'
       AND contact_email IS NULL
       AND domain IS NOT NULL
       AND NOT (coalesce(source_metadata,'{}'::jsonb) ? 'public_research_checked_at')
     ORDER BY qualification_score DESC NULLS LAST,created_at ASC
     LIMIT $2`,
    [clientId, safeLimit, segmentId ?? null]
  );

  let attempted = 0;
  let candidates = 0;
  let publishedEmailCandidates = 0;
  let blocked = 0;
  let errors = 0;

  for (const row of rows) {
    attempted++;
    const result = await researchPublicCompanySite(String(row.domain), titles);
    if (result.status === "BLOCKED") blocked++;
    if (result.status === "ERROR") errors++;
    if (result.candidate) candidates++;
    if (result.candidate?.publishedEmail) publishedEmailCandidates++;

    const candidate = result.candidate;
    const metadata = {
      public_research_checked_at: new Date().toISOString(),
      public_research: {
        status: result.status,
        domain: result.domain,
        decision_maker_name: candidate?.name ?? null,
        decision_maker_title: candidate?.title ?? null,
        decision_maker_confidence: candidate?.decisionMakerConfidence ?? 0,
        published_email: candidate?.publishedEmail ?? null,
        email_status: candidate?.publishedEmail ? "PUBLISHED_UNVERIFIED" : candidate?.inferredEmailCandidates.length ? "INFERRED_UNVERIFIED" : "NONE",
        email_confidence: candidate?.emailConfidence ?? 0,
        inferred_email_candidates: candidate?.inferredEmailCandidates ?? [],
        published_company_emails: result.publishedEmails.slice(0, 12),
        source_url: candidate?.sourceUrl ?? null,
        pages_checked: result.pagesChecked.slice(0, MAX_PAGES),
        evidence: candidate?.evidence ?? [],
        robots_respected: result.robotsRespected,
        error: result.error ?? null
      }
    };

    await pool.query(
      `UPDATE connect_prospects
       SET contact_name=CASE WHEN contact_name IS NULL AND $2::text IS NOT NULL AND $4::int >= 75 THEN $2 ELSE contact_name END,
           contact_title=CASE WHEN contact_title IS NULL AND $3::text IS NOT NULL AND $4::int >= 75 THEN $3 ELSE contact_title END,
           source_metadata=coalesce(source_metadata,'{}'::jsonb) || $5::jsonb,
           updated_at=now()
       WHERE id=$1`,
      [row.id, candidate?.name ?? null, candidate?.title ?? null, candidate?.decisionMakerConfidence ?? 0, JSON.stringify(metadata)]
    );
  }

  return {
    status: "COMPLETED" as const,
    provider: "ARBORLINE_RESEARCH" as const,
    attempted,
    candidates,
    publishedEmailCandidates,
    blocked,
    errors,
    segmentId: segmentId ?? null,
    sendReadyPromoted: 0
  };
}
