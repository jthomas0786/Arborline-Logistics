from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f"anchor not found in {path}: {old[:100]!r}")
    p.write_text(s.replace(old, new, 1))


public = "lib/connect-public-research.ts"

replace_once(public,
'''export type PublicResearchOptions = { expanded?: boolean; includePublicProfiles?: boolean; deadlineMs?: number };

export type PublicResearchResult = {
''',
'''export type PublicResearchOptions = { expanded?: boolean; includePublicProfiles?: boolean; deadlineMs?: number };

export type PublicEmailPattern =
  | "FIRST.LAST"
  | "FIRST_LAST"
  | "FIRST-LAST"
  | "FIRSTLAST"
  | "F_LAST"
  | "F.LAST"
  | "FIRST";

export type PublicEmailPatternObservation = {
  name: string;
  email: string;
  pattern: PublicEmailPattern;
  sourceUrl: string;
  sourceKind: "PUBLIC_SITE" | "PUBLIC_PROFILE";
  binding: "STRUCTURED_PERSON" | "MAILTO_PERSON_ANCHOR";
  confidence: number;
};

export type PublicResearchResult = {
''')

replace_once(public,
'''  candidate: PublicResearchCandidate | null;
  publishedEmails: string[];
  pagesChecked: string[];
''',
'''  candidate: PublicResearchCandidate | null;
  publishedEmails: string[];
  emailPatternObservations: PublicEmailPatternObservation[];
  pagesChecked: string[];
''')

replace_once(public,
'''function inferredEmails(name: string | null, domain: string) {
''',
'''function deriveEmailPattern(name: string, email: string, domain: string): PublicEmailPattern | null {
  if (!hostAllowed(email.split("@")[1] ?? "", domain)) return null;
  const parts = name.split(/\\s+/)
    .map(normalizeNameToken)
    .filter((part) => part && !HONORIFICS.has(part) && !NAME_SUFFIXES.has(part));
  if (parts.length < 2) return null;
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (!first || !last) return null;
  const local = (email.split("@")[0] ?? "").trim().toLowerCase();
  const candidates: Array<[PublicEmailPattern, string]> = [
    ["FIRST.LAST", `${first}.${last}`],
    ["FIRST_LAST", `${first}_${last}`],
    ["FIRST-LAST", `${first}-${last}`],
    ["FIRSTLAST", `${first}${last}`],
    ["F_LAST", `${first[0]}${last}`],
    ["F.LAST", `${first[0]}.${last}`],
    ["FIRST", first]
  ];
  return candidates.find(([, expected]) => expected === local)?.[0] ?? null;
}

function publicEmployeeEmailObservations(pages: PageSnapshot[], domain: string) {
  const observations = new Map<string, PublicEmailPatternObservation>();
  const remember = (observation: PublicEmailPatternObservation) => {
    const key = `${observation.name.toLowerCase()}|${observation.email.toLowerCase()}`;
    const existing = observations.get(key);
    if (!existing || observation.confidence > existing.confidence) observations.set(key, observation);
  };

  for (const page of pages) {
    for (const obj of jsonLdObjects(page.html)) {
      if (!schemaTypes(obj["@type"]).includes("person")) continue;
      const name = cleanName(String(obj.name ?? ""));
      const email = String(obj.email ?? "").trim().replace(/^mailto:/i, "").toLowerCase();
      if (!looksLikePersonName(name) || !email || !emailLooksLikeName(email, name)) continue;
      const pattern = deriveEmailPattern(name, email, domain);
      if (!pattern) continue;
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

    for (const match of page.html.matchAll(/<a\\b[^>]*href\\s*=\\s*["']mailto:([^"'?]+)(?:\\?[^"']*)?["'][^>]*>([\\s\\S]{0,240}?)<\\/a>/gi)) {
      const email = decodeHtml(match[1] ?? "").trim().toLowerCase();
      const name = cleanName(htmlToText(match[2] ?? ""));
      if (!email || !looksLikePersonName(name) || !emailLooksLikeName(email, name)) continue;
      const pattern = deriveEmailPattern(name, email, domain);
      if (!pattern) continue;
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
  return [...observations.values()]
    .sort((a, b) => b.confidence - a.confidence || a.email.localeCompare(b.email))
    .slice(0, 20);
}

function inferredEmails(name: string | null, domain: string) {
''')

s = Path(public).read_text()
s = s.replace('candidate: null, publishedEmails: [], pagesChecked:', 'candidate: null, publishedEmails: [], emailPatternObservations: [], pagesChecked:')
Path(public).write_text(s)

replace_once(public,
'''    const publishedEmails = [...new Set(allEvidencePages.flatMap((page) => extractEmails(page.html, domain)))];
    const textCandidate = candidateFromPages(allEvidencePages, domain, approvedTitles);
''',
'''    const publishedEmails = [...new Set(allEvidencePages.flatMap((page) => extractEmails(page.html, domain)))];
    const emailPatternObservations = publicEmployeeEmailObservations(allEvidencePages, domain);
    const textCandidate = candidateFromPages(allEvidencePages, domain, approvedTitles);
''')

replace_once(public,
'''      candidate,
      publishedEmails,
      pagesChecked: allEvidencePages.map((page) => page.url),
''',
'''      candidate,
      publishedEmails,
      emailPatternObservations,
      pagesChecked: allEvidencePages.map((page) => page.url),
''')

replace_once(public,
'''      candidate: null,
      publishedEmails: [],
      pagesChecked: [],
''',
'''      candidate: null,
      publishedEmails: [],
      emailPatternObservations: [],
      pagesChecked: [],
''')

replace_once(public,
'''        published_company_emails: result.publishedEmails.slice(0, 12),
        source_url: candidate?.sourceUrl ?? null,
''',
'''        published_company_emails: result.publishedEmails.slice(0, 12),
        public_email_pattern_observations: result.emailPatternObservations.slice(0, 20),
        source_url: candidate?.sourceUrl ?? null,
''')

worker = "lib/connect-national-worker-fleet.ts"
replace_once(worker,
'''    published_company_emails: result.publishedEmails.slice(0, 20),
    source_url: candidate.sourceUrl,
''',
'''    published_company_emails: result.publishedEmails.slice(0, 20),
    public_email_pattern_observations: result.emailPatternObservations.slice(0, 20),
    source_url: candidate.sourceUrl,
''')

native = "lib/connect-native-enrichment.ts"
replace_once(native,
'''async function bestPatterns(clientId: string, domain: string) {
''',
'''async function learnPublicObservedPatterns(clientId: string, domain: string, publicResearchValue: unknown) {
  const publicResearch = asObject(publicResearchValue);
  const raw = Array.isArray(publicResearch.public_email_pattern_observations)
    ? publicResearch.public_email_pattern_observations
    : [];
  const grouped = new Map<EmailPattern, { samples: number; maxConfidence: number }>();
  for (const item of raw) {
    const observation = asObject(item);
    const pattern = String(observation.pattern ?? "") as EmailPattern;
    if (!["FIRST.LAST","FIRST_LAST","FIRST-LAST","FIRSTLAST","F_LAST","F.LAST","FIRST"].includes(pattern)) continue;
    const email = String(observation.email ?? "").trim().toLowerCase();
    const name = String(observation.name ?? "").trim();
    if (!email || !name || !sameCompanyDomain(email, domain) || derivePattern(name, email, domain) !== pattern) continue;
    const confidence = Math.max(0, Math.min(100, Number(observation.confidence ?? 0) || 0));
    const current = grouped.get(pattern) ?? { samples: 0, maxConfidence: 0 };
    grouped.set(pattern, { samples: current.samples + 1, maxConfidence: Math.max(current.maxConfidence, confidence) });
  }

  for (const [pattern, observation] of grouped) {
    const confidence = Math.min(84, Math.max(72, observation.maxConfidence - 8 + Math.min(4, Math.max(0, observation.samples - 1) * 2)));
    await getPool().query(
      `INSERT INTO connect_domain_email_patterns
         (client_id,domain,pattern,verified_samples,confidence,metadata,last_observed_at)
       VALUES ($1,$2,$3,0,$4,$5::jsonb,now())
       ON CONFLICT (client_id,domain,pattern) DO UPDATE
       SET confidence=GREATEST(connect_domain_email_patterns.confidence,excluded.confidence),
           metadata=coalesce(connect_domain_email_patterns.metadata,'{}'::jsonb)||excluded.metadata,
           last_observed_at=now()`,
      [clientId, domain, pattern, confidence, JSON.stringify({
        source: "PUBLIC_PERSON_EMAIL_OBSERVATIONS",
        public_samples: observation.samples,
        mailbox_verified: false,
        version: 1
      })]
    );
  }
  return grouped.size;
}

async function bestPatterns(clientId: string, domain: string) {
''')

replace_once(native,
'''    await learnVerifiedPatterns(clientId, domain);
    const patterns = await bestPatterns(clientId, domain);
    if (patterns.length) patternsAvailable++;

    const metadata = asObject(row.source_metadata);
    const publicResearch = asObject(metadata.public_research);
''',
'''    await learnVerifiedPatterns(clientId, domain);
    const metadata = asObject(row.source_metadata);
    const publicResearch = asObject(metadata.public_research);
    await learnPublicObservedPatterns(clientId, domain, publicResearch);
    const patterns = await bestPatterns(clientId, domain);
    if (patterns.length) patternsAvailable++;

''')
