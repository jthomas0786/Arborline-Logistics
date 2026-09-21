from pathlib import Path
import re

PUBLIC = Path("lib/connect-public-research.ts")
WORKER = Path("lib/connect-national-worker-fleet.ts")

source = PUBLIC.read_text()
worker = WORKER.read_text()


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str) -> str:
    matches = list(re.finditer(pattern, text, flags=re.S))
    if len(matches) != 1:
        raise SystemExit(f"{label}: expected exactly one regex match, found {len(matches)}")
    return re.sub(pattern, lambda _m: replacement, text, count=1, flags=re.S)


source = replace_once(
    source,
    '''export type PublicEmailPatternObservation = {
  name: string;
  email: string;
  pattern: PublicEmailPattern;
  sourceUrl: string;
  sourceKind: "PUBLIC_SITE" | "PUBLIC_PROFILE";
  binding: "STRUCTURED_PERSON" | "MAILTO_PERSON_ANCHOR" | "TEXT_NAME_EMAIL_PROXIMITY";
  roleSignal?: boolean;
  confidence: number;
};

export type PublicResearchResult = {''',
    '''export type PublicEmailPatternObservation = {
  name: string;
  email: string;
  pattern: PublicEmailPattern;
  sourceUrl: string;
  sourceKind: "PUBLIC_SITE" | "PUBLIC_PROFILE";
  binding: "STRUCTURED_PERSON" | "MAILTO_PERSON_ANCHOR";
  confidence: number;
};

export type PublicEmailBindingDiagnostics = {
  pagesInspected: number;
  pagesWithMailto: number;
  mailtoLinksSeen: number;
  schemaPersonObjectsSeen: number;
  schemaPersonEmailObjectsSeen: number;
  companyDomainEmailsSeen: number;
  personalCompanyDomainEmailsSeen: number;
  acceptedStrictBindings: number;
  acceptedStructuredPerson: number;
  acceptedMailtoPersonAnchor: number;
  rejectedBindings: Record<string, number>;
};

export type PublicResearchDiagnostics = {
  pageDiscovery: {
    seededUrls: number;
    sitemapUrlsDiscovered: number;
    internalUrlsDiscovered: number;
    pagesFetched: number;
    profileUrlsDiscovered: number;
    profilePagesFetched: number;
    robotsSkipped: number;
    fetchFailures: number;
    contentTypeRejected: number;
    deadlineExceeded: boolean;
  };
  publicEmailBindings: PublicEmailBindingDiagnostics;
};

export type PublicResearchResult = {''',
    "strict observation and diagnostics types",
)

source = replace_once(
    source,
    '''  emailPatternObservations: PublicEmailPatternObservation[];
  pagesChecked: string[];''',
    '''  emailPatternObservations: PublicEmailPatternObservation[];
  diagnostics?: PublicResearchDiagnostics;
  pagesChecked: string[];''',
    "result diagnostics field",
)

new_observation_function = r'''function publicEmployeeEmailObservations(pages: PageSnapshot[], domain: string) {
  const observations = new Map<string, PublicEmailPatternObservation>();
  const rejectedBindings: Record<string, number> = {};
  const companyDomainEmails = new Set<string>();
  const personalCompanyDomainEmails = new Set<string>();
  let pagesWithMailto = 0;
  let mailtoLinksSeen = 0;
  let schemaPersonObjectsSeen = 0;
  let schemaPersonEmailObjectsSeen = 0;

  const reject = (reason: string, count = 1) => {
    rejectedBindings[reason] = (rejectedBindings[reason] ?? 0) + count;
  };
  const remember = (observation: PublicEmailPatternObservation) => {
    const key = `${observation.name.toLowerCase()}|${observation.email.toLowerCase()}`;
    const existing = observations.get(key);
    if (!existing || observation.confidence > existing.confidence) observations.set(key, observation);
  };

  for (const page of pages) {
    const pageCompanyEmails = extractEmails(page.html, domain);
    for (const email of pageCompanyEmails) companyDomainEmails.add(email);
    for (const email of personalEmails(pageCompanyEmails)) personalCompanyDomainEmails.add(email);

    for (const obj of jsonLdObjects(page.html)) {
      if (!schemaTypes(obj["@type"]).includes("person")) continue;
      schemaPersonObjectsSeen++;
      const name = cleanName(String(obj.name ?? ""));
      const email = String(obj.email ?? "").trim().replace(/^mailto:/i, "").toLowerCase();
      if (email) schemaPersonEmailObjectsSeen++;
      if (!looksLikePersonName(name)) {
        reject("STRUCTURED_PERSON_INVALID_NAME");
        continue;
      }
      if (!email || !email.includes("@")) {
        reject("STRUCTURED_PERSON_MISSING_OR_INVALID_EMAIL");
        continue;
      }
      if (!hostAllowed(email.split("@")[1] ?? "", domain)) {
        reject("STRUCTURED_PERSON_OFF_DOMAIN_EMAIL");
        continue;
      }
      if (!emailLooksLikeName(email, name)) {
        reject("STRUCTURED_PERSON_NAME_EMAIL_MISMATCH");
        continue;
      }
      const pattern = deriveEmailPattern(name, email, domain);
      if (!pattern) {
        reject("STRUCTURED_PERSON_UNSUPPORTED_PATTERN");
        continue;
      }
      remember({
        name,
        email,
        pattern,
        sourceUrl: page.url,
        sourceKind: page.sourceKind,
        binding: "STRUCTURED_PERSON",
        confidence: 92
      });
    }

    const mailtoMatches = [...page.html.matchAll(/<a\b[^>]*href\s*=\s*["']mailto:([^"'?]+)(?:\?[^"']*)?["'][^>]*>([\s\S]{0,240}?)<\/a>/gi)];
    if (mailtoMatches.length) pagesWithMailto++;
    mailtoLinksSeen += mailtoMatches.length;
    for (const match of mailtoMatches) {
      const email = decodeHtml(match[1] ?? "").trim().toLowerCase();
      const name = cleanName(htmlToText(match[2] ?? ""));
      if (!email || !email.includes("@")) {
        reject("MAILTO_PERSON_ANCHOR_MISSING_OR_INVALID_EMAIL");
        continue;
      }
      if (!looksLikePersonName(name)) {
        reject("MAILTO_PERSON_ANCHOR_VISIBLE_TEXT_NOT_PERSON_NAME");
        continue;
      }
      if (!hostAllowed(email.split("@")[1] ?? "", domain)) {
        reject("MAILTO_PERSON_ANCHOR_OFF_DOMAIN_EMAIL");
        continue;
      }
      if (!emailLooksLikeName(email, name)) {
        reject("MAILTO_PERSON_ANCHOR_NAME_EMAIL_MISMATCH");
        continue;
      }
      const pattern = deriveEmailPattern(name, email, domain);
      if (!pattern) {
        reject("MAILTO_PERSON_ANCHOR_UNSUPPORTED_PATTERN");
        continue;
      }
      remember({
        name,
        email,
        pattern,
        sourceUrl: page.url,
        sourceKind: page.sourceKind,
        binding: "MAILTO_PERSON_ANCHOR",
        confidence: 88
      });
    }
  }

  const accepted = [...observations.values()]
    .sort((a, b) => b.confidence - a.confidence || a.email.localeCompare(b.email))
    .slice(0, 20);
  const acceptedEmails = new Set(accepted.map((item) => item.email.toLowerCase()));
  const unboundPersonalEmails = [...personalCompanyDomainEmails]
    .filter((email) => !acceptedEmails.has(email.toLowerCase()));
  if (unboundPersonalEmails.length) reject("UNBOUND_PERSONAL_COMPANY_EMAIL", unboundPersonalEmails.length);

  return {
    observations: accepted,
    diagnostics: {
      pagesInspected: pages.length,
      pagesWithMailto,
      mailtoLinksSeen,
      schemaPersonObjectsSeen,
      schemaPersonEmailObjectsSeen,
      companyDomainEmailsSeen: companyDomainEmails.size,
      personalCompanyDomainEmailsSeen: personalCompanyDomainEmails.size,
      acceptedStrictBindings: accepted.length,
      acceptedStructuredPerson: accepted.filter((item) => item.binding === "STRUCTURED_PERSON").length,
      acceptedMailtoPersonAnchor: accepted.filter((item) => item.binding === "MAILTO_PERSON_ANCHOR").length,
      rejectedBindings
    } satisfies PublicEmailBindingDiagnostics
  };
}

function samePersonIdentity(left: string, right: string) {
  return normalizeTitle(cleanName(left)) === normalizeTitle(cleanName(right));
}

function strictPublishedObservationForName(
  observations: PublicEmailPatternObservation[],
  name: string,
  sourceKind?: PageSnapshot["sourceKind"]
) {
  return observations.find((item) =>
    samePersonIdentity(item.name, name) && (!sourceKind || item.sourceKind === sourceKind)
  ) ?? null;
}

function publishedCompanyEmailsForStorage(
  pages: PageSnapshot[],
  domain: string,
  observations: PublicEmailPatternObservation[]
) {
  const strictEmails = new Set(observations.map((item) => item.email.toLowerCase()));
  const all = [...new Set(pages.flatMap((page) => extractEmails(page.html, domain)))];
  return all.filter((email) => {
    if (strictEmails.has(email.toLowerCase())) return true;
    const local = email.split("@")[0]?.toLowerCase() ?? "";
    return GENERIC_EMAIL_LOCAL_PARTS.has(local);
  });
}

function inferredEmails'''

source = regex_once(
    source,
    r'function publicEmployeeEmailObservations\(pages: PageSnapshot\[\], domain: string\) \{.*?\n\}\n\nfunction inferredEmails',
    new_observation_function,
    "strict observation scanner",
)

new_attach = r'''function attachPublicProfileEmail(
  candidate: PublicResearchCandidate | null,
  observations: PublicEmailPatternObservation[]
) {
  if (!candidate?.name) return candidate;
  const matched = strictPublishedObservationForName(observations, candidate.name, "PUBLIC_PROFILE");
  if (!matched) return candidate;
  return {
    ...candidate,
    sourceKind: "PUBLIC_PROFILE" as const,
    publishedEmail: matched.email,
    emailConfidence: 98,
    inferredEmailCandidates: [],
    sourceUrl: matched.sourceUrl,
    evidence: [
      ...candidate.evidence,
      `${matched.email} is published with an exact person binding on a public business/social profile linked from the company website.`
    ]
  };
}

function peopleDiscoveryPriority(pathname: string) {
  const path = pathname.toLowerCase();
  if (/(team|leadership|staff|people|directory|bio|profile|employee|personnel|professionals?|executive)/.test(path)) return 0;
  if (/(owner|founder|management|meet|who[-_]?we[-_]?are|our[-_]?people|about)/.test(path)) return 1;
  if (/(contact|company|departments?|divisions?|locations?)/.test(path)) return 2;
  return 99;
}

function peopleDiscoveryPath(pathname: string) {
  const path = pathname.toLowerCase();
  if (/\.(?:pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|webp|svg|css|js|xml|zip)$/i.test(path)) return false;
  return peopleDiscoveryPriority(path) < 99;
}

function extractSameDomainLinks(html: string, baseUrl: string, domain: string) {
  const links: Array<{ url: string; priority: number; length: number }> = [];
  const pattern = /href\s*=\s*["']([^"'#]+)["']/gi;
  for (const match of html.matchAll(pattern)) {
    const href = match[1]?.trim();
    if (!href || /^mailto:|^tel:|^javascript:/i.test(href)) continue;
    try {
      const url = new URL(href, baseUrl);
      if (!/^https?:$/.test(url.protocol) || !hostAllowed(url.hostname, domain)) continue;
      const path = url.pathname.toLowerCase();
      if (!peopleDiscoveryPath(path)) continue;
      url.hash = "";
      url.search = "";
      links.push({ url: url.toString(), priority: peopleDiscoveryPriority(path), length: path.length });
    } catch {}
  }
  const deduped = new Map<string, { url: string; priority: number; length: number }>();
  for (const item of links) {
    const existing = deduped.get(item.url);
    if (!existing || item.priority < existing.priority) deduped.set(item.url, item);
  }
  return [...deduped.values()]
    .sort((a, b) => a.priority - b.priority || a.length - b.length || a.url.localeCompare(b.url))
    .map((item) => item.url);
}

const PUBLIC_PROFILE_HOSTS'''

source = regex_once(
    source,
    r'function attachPublicProfileEmail\(.*?\n\}\n\nfunction extractSameDomainLinks\(.*?\n\}\n\nconst PUBLIC_PROFILE_HOSTS',
    new_attach,
    "strict profile attachment and ranked internal discovery",
)

new_sitemap = r'''function extractSitemapLinks(xml: string, domain: string) {
  const links: Array<{ url: string; priority: number; length: number }> = [];
  for (const match of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
    const raw = decodeHtml(match[1] ?? "").trim();
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if (!/^https?:$/.test(url.protocol) || !hostAllowed(url.hostname, domain)) continue;
      const path = url.pathname.toLowerCase();
      if (!peopleDiscoveryPath(path)) continue;
      url.hash = "";
      url.search = "";
      links.push({ url: url.toString(), priority: peopleDiscoveryPriority(path), length: path.length });
    } catch {}
  }
  const deduped = new Map<string, { url: string; priority: number; length: number }>();
  for (const item of links) {
    const existing = deduped.get(item.url);
    if (!existing || item.priority < existing.priority) deduped.set(item.url, item);
  }
  return [...deduped.values()]
    .sort((a, b) => a.priority - b.priority || a.length - b.length || a.url.localeCompare(b.url))
    .map((item) => item.url);
}

function jsonLdObjects'''

source = regex_once(
    source,
    r'function extractSitemapLinks\(xml: string, domain: string\) \{.*?\n\}\n\nfunction jsonLdObjects',
    new_sitemap,
    "ranked sitemap discovery",
)

source = replace_once(
    source,
    'function candidateFromPages(pages: PageSnapshot[], domain: string, approvedTitles: string[]): PublicResearchCandidate | null {',
    'function candidateFromPages(pages: PageSnapshot[], domain: string, approvedTitles: string[], emailPatternObservations: PublicEmailPatternObservation[] = []): PublicResearchCandidate | null {',
    "candidate signature",
)
source = replace_once(
    source,
    '    const pageEmails = personalEmails(extractEmails(page.html, domain));\n',
    '',
    "remove loose page email pool",
)
source = replace_once(
    source,
    '      const nameEmail = pageEmails.find((email) => emailLooksLikeName(email, name)) ?? null;',
    '      const nameEmail = strictPublishedObservationForName(emailPatternObservations, name)?.email ?? null;',
    "strict candidate email binding",
)
source = replace_once(
    source,
    '          ? `${publishedEmail} is publicly listed on the company domain and matches the decision-maker name pattern.`',
    '          ? `${publishedEmail} is published with an exact Person JSON-LD or person-named mailto binding.`',
    "candidate evidence wording",
)

new_crawl_block = r'''    const queue = [
      `https://${domain}/`,
      `https://${domain}/about`,
      `https://${domain}/about-us`,
      `https://${domain}/team`,
      `https://${domain}/our-team`,
      `https://${domain}/leadership`,
      `https://${domain}/contact`,
      ...(options.expanded ? [
        `https://${domain}/staff`,
        `https://${domain}/people`,
        `https://${domain}/our-people`,
        `https://${domain}/management`,
        `https://${domain}/company`,
        `https://${domain}/our-company`,
        `https://${domain}/meet-the-team`,
        `https://${domain}/meet-our-team`,
        `https://${domain}/staff-directory`,
        `https://${domain}/directory`,
        `https://${domain}/professionals`,
        `https://${domain}/employees`,
        `https://${domain}/about/team`,
        `https://${domain}/about/leadership`,
        `https://${domain}/who-we-are`,
        `https://${domain}/locations`
      ] : [])
    ];
    const queued = new Set(queue);
    const pageDiscovery = {
      seededUrls: queue.length,
      sitemapUrlsDiscovered: 0,
      internalUrlsDiscovered: 0,
      pagesFetched: 0,
      profileUrlsDiscovered: 0,
      profilePagesFetched: 0,
      robotsSkipped: 0,
      fetchFailures: 0,
      contentTypeRejected: 0,
      deadlineExceeded: false
    };
    const enqueue = (url: string, sourceKind: "SITEMAP" | "INTERNAL") => {
      if (queued.has(url)) return;
      queued.add(url);
      queue.push(url);
      if (sourceKind === "SITEMAP") pageDiscovery.sitemapUrlsDiscovered++;
      else pageDiscovery.internalUrlsDiscovered++;
    };

    if (options.expanded) {
      for (const sitemapUrl of [`https://${domain}/sitemap.xml`, `https://${domain}/wp-sitemap.xml`]) {
        if (deadlineReached()) break;
        try {
          const sitemap = await fetchText(sitemapUrl, domain, 3, deadlineAt);
          if (!sitemap) {
            pageDiscovery.fetchFailures++;
            continue;
          }
          for (const discovered of extractSitemapLinks(sitemap.text, domain).slice(0, 60)) enqueue(discovered, "SITEMAP");
        } catch {
          pageDiscovery.fetchFailures++;
        }
      }
    }
    const visited = new Set<string>();
    const pages: PageSnapshot[] = [];
    const pageLimit = options.expanded ? 16 : MAX_PAGES;

    while (queue.length && pages.length < pageLimit && !deadlineReached()) {
      const next = queue.shift();
      if (!next) break;
      let parsed: URL;
      try { parsed = new URL(next); } catch { continue; }
      if (!robotsAllows(parsed.pathname || "/", robotsDisallow)) {
        pageDiscovery.robotsSkipped++;
        continue;
      }
      const key = `${parsed.protocol}//${normalizeHost(parsed.hostname)}${parsed.pathname}`.replace(/\/$/, "") || domain;
      if (visited.has(key)) continue;
      visited.add(key);

      let fetched: { url: string; text: string; contentType: string } | null = null;
      try {
        fetched = await fetchText(next, domain, 3, deadlineAt);
      } catch {
        pageDiscovery.fetchFailures++;
        continue;
      }
      if (!fetched) {
        pageDiscovery.fetchFailures++;
        continue;
      }
      if (fetched.contentType && !fetched.contentType.includes("text/html") && !fetched.contentType.includes("text/plain")) {
        pageDiscovery.contentTypeRejected++;
        continue;
      }

      const html = fetched.text;
      const text = htmlToText(html);
      pages.push({ url: fetched.url, html, text, sourceKind: "PUBLIC_SITE" });
      pageDiscovery.pagesFetched = pages.length;

      const perPageDiscoveryLimit = options.expanded ? 14 : pages.length === 1 ? 8 : 3;
      for (const discovered of extractSameDomainLinks(html, fetched.url, domain).slice(0, perPageDiscoveryLimit)) {
        enqueue(discovered, "INTERNAL");
      }
    }

    const profilePages: PageSnapshot[] = [];'''

source = regex_once(
    source,
    r'    const queue = \[.*?    const profilePages: PageSnapshot\[\] = \[\];',
    new_crawl_block,
    "deeper page discovery crawl",
)

source = replace_once(
    source,
    '''      const profileLinks = [...new Set(pages.flatMap((page) => extractPublicProfileLinks(page.html, page.url)))].slice(0, 3);
      for (const profileUrl of profileLinks) {''',
    '''      const profileLinks = [...new Set(pages.flatMap((page) => extractPublicProfileLinks(page.html, page.url)))].slice(0, 3);
      pageDiscovery.profileUrlsDiscovered = profileLinks.length;
      for (const profileUrl of profileLinks) {''',
    "profile discovery diagnostics",
)
source = replace_once(
    source,
    '''          profilePages.push({
            url: fetched.url,
            html: fetched.text,
            text: htmlToText(fetched.text),
            sourceKind: "PUBLIC_PROFILE"
          });''',
    '''          profilePages.push({
            url: fetched.url,
            html: fetched.text,
            text: htmlToText(fetched.text),
            sourceKind: "PUBLIC_PROFILE"
          });
          pageDiscovery.profilePagesFetched = profilePages.length;''',
    "profile fetched diagnostics",
)

source = replace_once(
    source,
    '''    const allEvidencePages = [...pages, ...profilePages];
    const publishedEmails = [...new Set(allEvidencePages.flatMap((page) => extractEmails(page.html, domain)))];
    const emailPatternObservations = publicEmployeeEmailObservations(allEvidencePages, domain);
    const textCandidate = candidateFromPages(allEvidencePages, domain, approvedTitles);''',
    '''    const allEvidencePages = [...pages, ...profilePages];
    const patternScan = publicEmployeeEmailObservations(allEvidencePages, domain);
    const emailPatternObservations = patternScan.observations;
    const publishedEmails = publishedCompanyEmailsForStorage(allEvidencePages, domain, emailPatternObservations);
    const textCandidate = candidateFromPages(allEvidencePages, domain, approvedTitles, emailPatternObservations);''',
    "strict published email result assembly",
)
source = replace_once(
    source,
    '    const candidate = attachPublicProfileEmail(baseCandidate, profilePages, domain);',
    '    const candidate = attachPublicProfileEmail(baseCandidate, emailPatternObservations);',
    "strict profile attachment call",
)
source = replace_once(
    source,
    '''    const serviceFit = evaluateConnectServiceFit(segmentSlug, pages, targetIndustries);
    const deadlineExceeded = deadlineReached();
    return {''',
    '''    const serviceFit = evaluateConnectServiceFit(segmentSlug, pages, targetIndustries);
    const deadlineExceeded = deadlineReached();
    pageDiscovery.deadlineExceeded = deadlineExceeded;
    const diagnostics: PublicResearchDiagnostics = {
      pageDiscovery,
      publicEmailBindings: patternScan.diagnostics
    };
    return {''',
    "result diagnostics assembly",
)
source = replace_once(
    source,
    '''      publishedEmails,
      emailPatternObservations,
      pagesChecked:''',
    '''      publishedEmails,
      emailPatternObservations,
      diagnostics,
      pagesChecked:''',
    "result diagnostics return",
)

source = replace_once(
    source,
    '''        status: result.status,
        domain: result.domain,
        decision_maker_name:''',
    '''        status: result.status,
        domain: result.domain,
        diagnostics: result.diagnostics ?? null,
        decision_maker_name:''',
    "standard research diagnostics persistence",
)

worker = replace_once(
    worker,
    '''        status: result.status,
        research_mode: benchmarkMode ? "PUBLIC_PROFILE_BENCHMARK_V2" : row.is_qualification_acceleration ? "QUALIFICATION_ACCELERATION" : "STANDARD",
        domain: result.domain,
        decision_maker_name:''',
    '''        status: result.status,
        research_mode: benchmarkMode ? "PUBLIC_PROFILE_BENCHMARK_V2" : row.is_qualification_acceleration ? "QUALIFICATION_ACCELERATION" : "STANDARD",
        domain: result.domain,
        diagnostics: result.diagnostics ?? null,
        decision_maker_name:''',
    "national research diagnostics persistence",
)
worker = replace_once(
    worker,
    '        pages_checked: result.pagesChecked.slice(0, benchmarkMode ? 15 : 7),',
    '        pages_checked: result.pagesChecked.slice(0, benchmarkMode ? 20 : 7),',
    "expanded pages checked persistence",
)

# Guardrails: this patch must make reach broader while keeping acceptance exact.
required_public = [
    'binding: "STRUCTURED_PERSON" | "MAILTO_PERSON_ANCHOR";',
    'UNBOUND_PERSONAL_COMPANY_EMAIL',
    'diagnostics?: PublicResearchDiagnostics;',
    'const pageLimit = options.expanded ? 16 : MAX_PAGES;',
    'for (const discovered of extractSameDomainLinks(html, fetched.url, domain).slice(0, perPageDiscoveryLimit))',
    'const publishedEmails = publishedCompanyEmailsForStorage(allEvidencePages, domain, emailPatternObservations);',
    'const nameEmail = strictPublishedObservationForName(emailPatternObservations, name)?.email ?? null;',
]
for needle in required_public:
    if needle not in source:
        raise SystemExit(f"missing public-research guardrail after patch: {needle}")

if 'binding: "TEXT_NAME_EMAIL_PROXIMITY"' in source:
    raise SystemExit("proximity binding still exists in the strict observation scanner")
if 'const pageEmails = personalEmails(extractEmails(page.html, domain));' in source:
    raise SystemExit("loose page email pool still exists")
if 'diagnostics: result.diagnostics ?? null' not in worker:
    raise SystemExit("national worker diagnostics were not persisted")

PUBLIC.write_text(source)
WORKER.write_text(worker)
print("patched deep public page discovery, strict email acceptance, and diagnostics")
