import { isIP } from "node:net";
import { getPool } from "@/lib/db";
import { scoreConnectProspect, type ConnectIcpProfile } from "@/lib/connect-prospect-scoring";

const USER_AGENT = "ArborLineResearch/1.0 (+https://www.arborlineconnect.com)";
const MAX_PAGES = 7;
const MAX_PAGE_BYTES = 750_000;
const FETCH_TIMEOUT_MS = 10_000;
const HIGH_CONFIDENCE_THRESHOLD = 85;
const GENERIC_EMAIL_LOCAL_PARTS = new Set([
  "admin", "billing", "careers", "contact", "hello", "hr", "info", "jobs", "marketing",
  "office", "sales", "service", "support", "team"
]);
const NAME_PARTICLES = new Set(["al", "bin", "da", "de", "del", "della", "der", "di", "du", "la", "le", "van", "von"]);
const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC"
]);
const NON_PERSON_TERMS = new Set([
  "about", "air", "business", "cleaner", "cleaners", "cleaning", "commercial", "company", "contact",
  "contractor", "contractors", "cooling", "customer", "customers", "expert", "experts", "facility", "group",
  "grounds", "heating", "helping", "home", "house", "hvac", "janitorial", "landscape", "landscaping", "lawn",
  "local", "management", "mechanical", "office", "professional", "professionals", "recruiting", "residential",
  "restoration", "service", "services", "solutions", "specialist", "specialists", "staff", "staffing", "team",
  "technician", "technicians", "typical", "workforce", "roof", "roofer", "roofers", "roofing",
  "pest", "plumber", "plumbers", "plumbing", "fire", "protection", "sprinkler", "sprinklers",
  "quote", "request", "schedule", "call", "free", "downtown"
]);

export type PublicResearchConfidenceGrade = "HIGH" | "MEDIUM" | "LOW";

export type PublicResearchCandidate = {
  name: string | null;
  title: string | null;
  decisionMakerConfidence: number;
  confidenceGrade: PublicResearchConfidenceGrade;
  corroboratingPages: number;
  proximity: "SAME_LINE" | "ADJACENT_LINE";
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

function titleCaseNameToken(word: string) {
  const stripped = word.replace(/[.'’-]/g, "");
  if (!stripped) return false;
  if (/^[A-Z]{1,4}$/.test(stripped)) return true;
  return /^[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ]*$/.test(stripped);
}

function looksLikePersonName(value: string) {
  const name = cleanName(value);
  if (name.length < 4 || name.length > 70 || /[!?=<>/@]/.test(name)) return false;
  const words = name.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  if (words.some((word) => /\d|https?|www\./i.test(word))) return false;
  // A raw two-letter uppercase state code beside a title is almost always
  // location/service-area text, not part of a person's name (e.g. Northglenn CO).
  if (words.some((word) => /^[A-Z]{2}$/.test(word) && US_STATE_CODES.has(word))) return false;

  const normalizedWords = words.map((word) => word.toLowerCase().replace(/[^a-zà-öø-ÿ]/g, ""));
  // Long adjacent strings without a real name particle are commonly nav/service-area
  // phrases. Keep precision high; 2-3 token names remain unaffected.
  if (words.length > 3 && !normalizedWords.some((word) => NAME_PARTICLES.has(word))) return false;
  if (normalizedWords.some((word) => NON_PERSON_TERMS.has(word))) return false;

  const semanticBanned = /\b(team|leadership|management|contact|about|services?|company|landscap(?:e|ing)|hvac|clean(?:er|ers|ing)?|staffing|roof(?:er|ers|ing)?|pest|plumb(?:er|ers|ing)?|fire|protection|sprinklers?|quote|request|schedule|call|free|director|manager|president|owner|founder|chief|officer|sales|operations|commercial|residential|professionals?|specialists?)\b/i;
  if (semanticBanned.test(name)) return false;

  let primaryTokens = 0;
  for (const word of words) {
    const normalized = word.toLowerCase().replace(/[^a-zà-öø-ÿ]/g, "");
    if (NAME_PARTICLES.has(normalized)) continue;
    primaryTokens++;
    if (!titleCaseNameToken(word)) return false;
  }
  return primaryTokens >= 2;
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

function normalizedNameSearch(value: string) {
  return ` ${normalizeTitle(value)} `;
}

function corroboratingPageCount(pages: PageSnapshot[], name: string) {
  const needle = normalizedNameSearch(name);
  return pages.filter((page) => ` ${normalizeTitle(page.text)} `.includes(needle)).length;
}

function confidenceGrade(value: number): PublicResearchConfidenceGrade {
  if (value >= HIGH_CONFIDENCE_THRESHOLD) return "HIGH";
  if (value >= 75) return "MEDIUM";
  return "LOW";
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
          ? line.replace(new RegExp(escapeRegex(matchedTitle), "i"), " ")
          : line
      );

      const sameLineName = looksLikePersonName(sameLineWithoutTitle) ? sameLineWithoutTitle : null;
      const adjacentName = [lines[index - 1], lines[index + 1]]
        .filter((value): value is string => Boolean(value))
        .map(cleanName)
        .find(looksLikePersonName) ?? null;
      const name = sameLineName ?? adjacentName;
      if (!name) continue;

      const proximity: "SAME_LINE" | "ADJACENT_LINE" = sameLineName ? "SAME_LINE" : "ADJACENT_LINE";
      const corroboratingPages = corroboratingPageCount(pages, name);
      const nameEmail = pageEmails.find((email) => emailLooksLikeName(email, name)) ?? null;
      const publishedEmail = nameEmail;
      const path = new URL(page.url).pathname.toLowerCase();
      const leadershipPage = /team|leadership|people|management|staff|about/.test(path);

      let decisionMakerConfidence = proximity === "SAME_LINE" ? 82 : 76;
      if (leadershipPage) decisionMakerConfidence += 8;
      if (corroboratingPages >= 2) decisionMakerConfidence += 7;
      if (nameEmail) decisionMakerConfidence += 8;
      decisionMakerConfidence = Math.min(99, decisionMakerConfidence);

      const grade = confidenceGrade(decisionMakerConfidence);
      const emailConfidence = publishedEmail ? 96 : 0;
      const evidence = [
        `${name} appears ${proximity === "SAME_LINE" ? "on the same line as" : "directly beside"} an approved decision-maker title (${matchedTitle}) on ${path || "/"}.`,
        leadershipPage ? "The evidence comes from a leadership/team/about-style company page." : "The evidence comes from a general company page.",
        corroboratingPages >= 2 ? `${name} appears on ${corroboratingPages} checked company pages.` : `${name} appears on one checked company page.`,
        publishedEmail
          ? `${publishedEmail} is publicly listed on the company domain and matches the decision-maker name pattern.`
          : "No person-matching decision-maker email was published on the checked pages."
      ];

      const candidate: PublicResearchCandidate = {
        name,
        title: matchedTitle,
        decisionMakerConfidence,
        confidenceGrade: grade,
        corroboratingPages,
        proximity,
        publishedEmail,
        emailConfidence,
        inferredEmailCandidates: publishedEmail ? [] : inferredEmails(name, domain),
        sourceUrl: page.url,
        evidence
      };

      const candidateStrength = candidate.decisionMakerConfidence + candidate.emailConfidence;
      const bestStrength = best ? best.decisionMakerConfidence + best.emailConfidence : -1;
      if (candidateStrength > bestStrength) best = candidate;
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
      `SELECT * FROM connect_prospect_segments
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
       AND (
         qualification_status='QUALIFIED'
         OR (
           qualification_status='REVIEW'
           AND coalesce(qualification_score,0) >= 60
           AND source='ARBORLINE_DISCOVERY'
         )
       )
       AND contact_email IS NULL
       AND domain IS NOT NULL
       AND NOT (coalesce(source_metadata,'{}'::jsonb) ? 'public_research_checked_at')
     ORDER BY qualification_score DESC NULLS LAST,created_at ASC
     LIMIT $2`,
    [clientId, safeLimit, segmentId ?? null]
  );

  let attempted = 0;
  let candidates = 0;
  let highConfidenceCandidates = 0;
  let publishedEmailCandidates = 0;
  let blocked = 0;
  let errors = 0;
  let qualifiedAfterResearch = 0;

  for (const row of rows) {
    attempted++;
    const result = await researchPublicCompanySite(String(row.domain), titles);
    if (result.status === "BLOCKED") blocked++;
    if (result.status === "ERROR") errors++;
    if (result.candidate) candidates++;
    if (result.candidate?.confidenceGrade === "HIGH") highConfidenceCandidates++;
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
        decision_maker_confidence_grade: candidate?.confidenceGrade ?? "LOW",
        decision_maker_corroborating_pages: candidate?.corroboratingPages ?? 0,
        decision_maker_proximity: candidate?.proximity ?? null,
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
       SET contact_name=CASE WHEN contact_name IS NULL AND $2::text IS NOT NULL AND $4::int >= $6::int THEN $2 ELSE contact_name END,
           contact_title=CASE WHEN contact_title IS NULL AND $3::text IS NOT NULL AND $4::int >= $6::int THEN $3 ELSE contact_title END,
           source_metadata=coalesce(source_metadata,'{}'::jsonb) || $5::jsonb,
           updated_at=now()
       WHERE id=$1`,
      [row.id, candidate?.name ?? null, candidate?.title ?? null, candidate?.decisionMakerConfidence ?? 0, JSON.stringify(metadata), HIGH_CONFIDENCE_THRESHOLD]
    );

    // Strong self-discovered REVIEW prospects can become QUALIFIED when
    // public research adds a HIGH-confidence approved decision-maker. The
    // re-score never makes outreach send-ready; email promotion is a separate
    // safety gate in the research route.
    if (segmentId && profile.rows[0]) {
      const currentResult = await pool.query(
        `SELECT p.*, EXISTS (
           SELECT 1 FROM connect_suppressions s
           WHERE (s.client_id IS NULL OR s.client_id=p.client_id)
             AND ((s.email IS NOT NULL AND lower(s.email)=lower(p.contact_email))
               OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain)))
         ) AS is_suppressed
         FROM connect_prospects p WHERE p.id=$1 LIMIT 1`,
        [row.id]
      );
      const current = currentResult.rows[0];
      const segment = profile.rows[0];
      if (current) {
        const suppression = current.is_suppressed ? "DO_NOT_CONTACT" : current.suppression_status;
        const segmentProfile: ConnectIcpProfile = {
          target_industries: segment.target_industries ?? [],
          target_geographies: segment.target_geographies ?? [],
          min_employees: segment.min_employees,
          max_employees: segment.max_employees,
          min_locations: segment.min_locations,
          max_locations: segment.max_locations,
          facility_types: segment.facility_types ?? [],
          decision_maker_titles: segment.decision_maker_titles ?? [],
          buying_signals: segment.buying_signals ?? [],
          exclusions: segment.exclusions ?? [],
          minimum_score: segment.minimum_score ?? 70
        };
        const scored = scoreConnectProspect({
          company_name: current.company_name,
          domain: current.domain,
          industry: current.industry,
          city: current.city,
          state: current.state,
          country: current.country,
          employee_count: current.employee_count,
          location_count: current.location_count,
          facility_type: current.facility_type,
          contact_title: current.contact_title,
          buying_signals: current.buying_signals,
          suppression_status: suppression
        }, segmentProfile);
        await pool.query(
          `UPDATE connect_prospects
           SET qualification_score=$2,qualification_status=$3,qualification_reasons=$4::jsonb,
               suppression_status=$5,outreach_status='NOT_READY',last_scored_at=now(),updated_at=now()
           WHERE id=$1`,
          [row.id, scored.score, scored.status, JSON.stringify(scored.reasons), suppression]
        );
        if (scored.status === "QUALIFIED") qualifiedAfterResearch++;
      }
    }
  }

  return {
    status: "COMPLETED" as const,
    provider: "ARBORLINE_RESEARCH" as const,
    attempted,
    candidates,
    highConfidenceCandidates,
    publishedEmailCandidates,
    blocked,
    errors,
    qualifiedAfterResearch,
    segmentId: segmentId ?? null,
    sendReadyPromoted: 0
  };
}
