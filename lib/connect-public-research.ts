import { isIP } from "node:net";
import { getPool } from "@/lib/db";
import { scoreConnectProspect, type ConnectIcpProfile } from "@/lib/connect-prospect-scoring";
import { evaluateConnectServiceFit, type ConnectServiceFitResult } from "@/lib/connect-service-fit";
import {
  expandDecisionMakerTitles,
  rankSharedInboxes,
  scoreContactTarget,
  type ContactCompanySize,
  type ContactLocationMatch,
  type ContactRoleFunction,
  type ContactSeniority,
  type ContactTargetingContext,
  type SharedInboxCandidate
} from "@/lib/connect-contact-targeting";

const USER_AGENT = "ArborLineResearch/1.0 (+https://www.arborlineconnect.com)";
const MAX_PAGES = 7;
const MAX_PAGE_BYTES = 750_000;
const FETCH_TIMEOUT_MS = 10_000;
const HIGH_CONFIDENCE_THRESHOLD = 85;
const GENERIC_EMAIL_LOCAL_PARTS = new Set([
  "admin", "billing", "careers", "contact", "hello", "hr", "info", "jobs", "marketing",
  "office", "sales", "service", "support", "team", "workorder", "placeservicecall", "customerservice",
  "customercare", "firealarm", "voe"
]);
const NAME_PARTICLES = new Set(["al", "bin", "da", "de", "del", "della", "der", "di", "du", "la", "le", "van", "von"]);
const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "professor", "sir", "madam"]);
const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);
const NON_PERSON_PHRASES = ["master gardener", "stewardship taking", "partners personnel", "yer usa", "german desk"];
const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC"
]);
const US_STATE_NAMES = new Set([
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida",
  "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine",
  "maryland", "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada",
  "new hampshire", "new jersey", "new mexico", "new york", "north carolina", "north dakota", "ohio", "oklahoma",
  "oregon", "pennsylvania", "rhode island", "south carolina", "south dakota", "tennessee", "texas", "utah",
  "vermont", "virginia", "washington", "west virginia", "wisconsin", "wyoming"
]);
const GEO_DIRECTION_WORDS = new Set([
  "north", "south", "east", "west", "central", "northern", "southern", "eastern", "western", "northeast",
  "northwest", "southeast", "southwest", "metro", "greater", "midwest", "midwestern", "region", "regional"
]);

const NON_PERSON_TERMS = new Set([
  "about", "air", "business", "cleaner", "cleaners", "cleaning", "commercial", "company", "contact",
  "contractor", "contractors", "cooling", "customer", "customers", "expert", "experts", "facility", "group",
  "grounds", "heating", "helping", "home", "house", "hvac", "janitorial", "landscape", "landscaping", "lawn",
  "local", "management", "mechanical", "office", "professional", "professionals", "recruiting", "residential",
  "restoration", "service", "services", "solutions", "specialist", "specialists", "staff", "staffing", "team",
  "technician", "technicians", "typical", "workforce", "suppression", "roof", "roofer", "roofers", "roofing",
  "pest", "plumber", "plumbers", "plumbing", "fire", "protection", "sprinkler", "sprinklers",
  "quote", "request", "schedule", "call", "free", "downtown", "view", "all", "projects", "learn", "more",
  "from", "our", "meet", "the", "trusted", "by", "welcome", "your", "read", "know",
  "certified", "arborist", "united", "states", "government", "strip", "mall", "ceo", "cfo", "coo",
  "software", "development", "engineering", "technology", "technologies", "digital", "accounting", "finance", "financial",
  "human", "resources", "administration", "administrative", "administrator", "procurement", "purchasing", "department", "division",
  "outgoing", "incoming", "appointed", "former", "retiring", "retired", "interim", "association", "associations"
]);

export type PublicResearchConfidenceGrade = "HIGH" | "MEDIUM" | "LOW";

export type PublicResearchCandidate = {
  name: string | null;
  title: string | null;
  decisionMakerConfidence: number;
  confidenceGrade: PublicResearchConfidenceGrade;
  corroboratingPages: number;
  proximity: "SAME_LINE" | "ADJACENT_LINE" | "STRUCTURED_DATA";
  sourceKind: "PUBLIC_SITE" | "PUBLIC_PROFILE";
  publishedEmail: string | null;
  emailConfidence: number;
  inferredEmailCandidates: string[];
  sourceUrl: string | null;
  targetingScore: number;
  targetingCompanySize: ContactCompanySize;
  targetingRoleFunction: ContactRoleFunction;
  targetingSeniority: ContactSeniority;
  targetingLocationMatch: ContactLocationMatch;
  targetingReasons: string[];
  evidence: string[];
};

export type PublicResearchOptions = ContactTargetingContext & { expanded?: boolean; includePublicProfiles?: boolean; deadlineMs?: number };

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
    fetchFailureReasons: Record<string, number>;
    fetchFailureStatusCodes: Record<string, number>;
    fetchFailureSamples: Array<{ url: string; reason: string; status: number | null }>;
    lowValueUrlsSkipped: number;
    highValueUrlsPrioritized: number;
    contentTypeRejected: number;
    deadlineExceeded: boolean;
  };
  publicEmailBindings: PublicEmailBindingDiagnostics;
};

export type PublicResearchResult = {
  status: "CANDIDATE_FOUND" | "NO_MATCH" | "BLOCKED" | "ERROR";
  domain: string;
  candidate: PublicResearchCandidate | null;
  publishedEmails: string[];
  emailPatternObservations: PublicEmailPatternObservation[];
  sharedInboxCandidates?: SharedInboxCandidate[];
  diagnostics?: PublicResearchDiagnostics;
  pagesChecked: string[];
  robotsRespected: boolean;
  serviceFit?: ConnectServiceFitResult;
  error?: string;
};

type PageSnapshot = {
  url: string;
  text: string;
  html: string;
  sourceKind: "PUBLIC_SITE" | "PUBLIC_PROFILE";
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

function deadlineTimeoutMs(deadlineAt: number | null) {
  if (deadlineAt === null) return FETCH_TIMEOUT_MS;
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) return 0;
  return Math.max(1, Math.min(FETCH_TIMEOUT_MS, remaining));
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
    .replace(/^(?:sincerely|best regards|kind regards|regards|respectfully|operator)\s+/i, "")
    .replace(/^[^A-Za-zÀ-ÖØ-öø-ÿ]+|[^A-Za-zÀ-ÖØ-öø-ÿ.'’-]+$/g, "")
    .replace(/\s+/g, " ")
    // Text such as "Jane Smith Co-Founder" can leave a trailing "Co-" when
    // the approved title matcher consumes only "Founder". Drop that artifact.
    .replace(/\s+Co-$/i, "")
    // Some CMS/text extractions render a visual separator as a trailing "I"
    // immediately before the role (for example "Mark Schouten I President").
    // Prefer the two-token person identity over persisting the separator artifact.
    .replace(/\s+I$/, "")
    .trim();
}

function titleCaseNameToken(word: string) {
  const stripped = word.replace(/[.'’-]/g, "");
  if (!stripped) return false;
  if (/^[A-Z]{1,4}$/.test(stripped)) return true;
  return /^[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ]*$/.test(stripped);
}

function looksLikeGeographyLabel(value: string) {
  const normalized = normalizeTitle(cleanName(value));
  if (!normalized) return false;
  if (US_STATE_NAMES.has(normalized)) return true;
  const words = normalized.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  const hasDirection = words.some((word) => GEO_DIRECTION_WORDS.has(word));
  const hasState = [...US_STATE_NAMES].some((state) => normalized === state || normalized.endsWith(` ${state}`));
  const hasRegionWord = words.some((word) => ["region", "regional", "metro", "area", "territory"].includes(word));
  return (hasDirection && hasState) || (hasDirection && hasRegionWord);
}

function classifyRejectedPersonName(value: string) {
  const name = cleanName(value);
  if (!name || name.length < 4 || name.length > 70) return "LENGTH_OR_EMPTY";
  if (/[!?=<>/@]/.test(name)) return "SYMBOL_OR_URL";
  const words = name.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 5) return "TOKEN_COUNT";
  if (words.some((word) => /\d|https?|www\./i.test(word))) return "DIGIT_OR_URL";
  if (words.some((word) => /^[A-Z]{2}$/.test(word) && US_STATE_CODES.has(word))) return "STATE_CODE_LABEL";
  if (looksLikeGeographyLabel(name)) return "GEOGRAPHY_LABEL";
  const normalized = words.map((word) => word.toLowerCase().replace(/[^a-zà-öø-ÿ]/g, ""));
  if (normalized.some((word) => NON_PERSON_TERMS.has(word))) return "NON_PERSON_TERM";
  if (NON_PERSON_PHRASES.some((phrase) => normalizeTitle(name).includes(phrase))) return "NON_PERSON_PHRASE";
  if (words.some((word) => !titleCaseNameToken(word) && !NAME_PARTICLES.has(word.toLowerCase().replace(/[^a-zà-öø-ÿ]/g, "")) && !HONORIFICS.has(word.toLowerCase().replace(/[^a-zà-öø-ÿ]/g, "")) && !NAME_SUFFIXES.has(word.toLowerCase().replace(/[^a-zà-öø-ÿ]/g, "")))) return "CASE_OR_TOKEN_SHAPE";
  return "OTHER";
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
  if (looksLikeGeographyLabel(name)) return false;

  const normalizedWords = words.map((word) => word.toLowerCase().replace(/[^a-zà-öø-ÿ]/g, ""));
  const normalizedPhrase = normalizeTitle(name);
  if (NON_PERSON_PHRASES.some((phrase) => normalizedPhrase.includes(phrase))) return false;
  const substantiveTokens = normalizedWords.filter((word) =>
    word && !NAME_PARTICLES.has(word) && !HONORIFICS.has(word) && !NAME_SUFFIXES.has(word)
  );
  // Honorific + surname alone is not enough identity for safe email inference.
  // Full identities such as "Dr. Jane Smith" remain valid.
  if (HONORIFICS.has(normalizedWords[0] ?? "") && substantiveTokens.length < 2) return false;
  // Long adjacent strings without a real name particle are commonly nav/service-area
  // phrases. Keep precision high; 2-3 token names remain unaffected.
  if (words.length > 3 && !normalizedWords.some((word) => NAME_PARTICLES.has(word))) return false;
  if (normalizedWords.some((word) => NON_PERSON_TERMS.has(word))) return false;

  const semanticBanned = /\b(team|leadership|management|contact|about|services?|company|landscap(?:e|ing)|hvac|clean(?:er|ers|ing)?|staffing|roof(?:er|ers|ing)?|pest|plumb(?:er|ers|ing)?|fire|protection|sprinklers?|suppression|quote|request|schedule|call|free|director|manager|president|owner|founder|chief|officer|sales|operations|commercial|residential|professionals?|specialists?|certified|arborist|government|strip|mall|ceo|cfo|coo|software|development|engineering|technology|technologies|digital|accounting|finance|financial|human|resources|administration|administrative|administrator|procurement|purchasing|department|division|outgoing|incoming|former|retiring|retired|interim|association|associations)\b/i;
  if (semanticBanned.test(name)) return false;

  let primaryTokens = 0;
  for (const word of words) {
    const normalized = word.toLowerCase().replace(/[^a-zà-öø-ÿ]/g, "");
    if (NAME_PARTICLES.has(normalized) || HONORIFICS.has(normalized) || NAME_SUFFIXES.has(normalized)) continue;
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

function emailNameParts(name: string) {
  const parts = name.split(/\s+/)
    .map(normalizeNameToken)
    .filter((part) => part && !HONORIFICS.has(part) && !NAME_SUFFIXES.has(part));
  if (parts.length < 2) return null;
  const givenCandidates = parts.slice(0, -1).filter((part) => !NAME_PARTICLES.has(part));
  const first = givenCandidates.find((part) => part.length > 1) ?? givenCandidates[0] ?? parts[0];
  let surnameStart = parts.length - 1;
  while (surnameStart > 0 && NAME_PARTICLES.has(parts[surnameStart - 1])) surnameStart--;
  const last = parts.slice(surnameStart).join("");
  if (!first || !last || first === last) return null;
  return { first, last };
}

function emailLooksLikeName(email: string, name: string) {
  const local = normalizeNameToken(email.split("@")[0] ?? "");
  const parts = emailNameParts(name);
  if (!parts || !local) return false;
  const { first, last } = parts;
  if (local.includes(last) && (local.includes(first) || local.startsWith(first[0] ?? ""))) return true;
  // Published profile addresses are often first-name-only or a familiar shortened
  // form (e.g. chris@ for Christine). Require at least four characters and a
  // deterministic prefix relationship; mailbox verification is still mandatory.
  if (local.length >= 4 && (first.startsWith(local) || local.startsWith(first))) return true;
  return false;
}

function deriveEmailPattern(name: string, email: string, domain: string): PublicEmailPattern | null {
  if (!hostAllowed(email.split("@")[1] ?? "", domain)) return null;
  const parts = emailNameParts(name);
  if (!parts) return null;
  const { first, last } = parts;
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

const PERSON_ROLE_SIGNAL = /\b(?:president|owner|founder|co-founder|chief|ceo|cfo|coo|officer|vice president|vp|director|manager|partner|principal|executive|recruiter|coordinator|administrator|supervisor|sales|operations|business development|account executive|project manager|general manager)\b/i;

function hasPersonRoleSignal(value: string) {
  return PERSON_ROLE_SIGNAL.test(value);
}

function nearbyPersonNameForEmail(text: string, email: string, domain: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const lowerText = text.toLowerCase();
  let searchFrom = 0;
  let best: { name: string; pattern: PublicEmailPattern; distance: number } | null = null;

  while (searchFrom < lowerText.length) {
    const emailIndex = lowerText.indexOf(normalizedEmail, searchFrom);
    if (emailIndex < 0) break;
    const windowStart = Math.max(0, emailIndex - 700);
    const before = text.slice(windowStart, emailIndex);
    const tokens = [...before.matchAll(/\b[A-Z][A-Za-z'’.-]*\b/g)]
      .filter((match) => Boolean(match[0]))
      .slice(-80);

    for (let end = tokens.length - 1; end >= 1; end--) {
      for (let length = 2; length <= 4; length++) {
        const start = end - length + 1;
        if (start < 0) continue;
        const candidate = cleanName(tokens.slice(start, end + 1).map((match) => match[0]).join(" "));
        if (!looksLikePersonName(candidate) || !emailLooksLikeName(normalizedEmail, candidate)) continue;
        const pattern = deriveEmailPattern(candidate, normalizedEmail, domain);
        // A first-name-only address cannot validate the surname, so free-text
        // proximity alone is insufficient. FIRST is handled separately using
        // visible line/card boundaries below.
        if (!pattern || pattern === "FIRST") continue;
        const tokenStart = tokens[start].index ?? before.length;
        const distance = before.length - tokenStart;
        if (distance > 700) continue;
        const roleContext = before.slice(Math.max(0, tokenStart - 160));
        if (!hasPersonRoleSignal(roleContext)) continue;
        if (!best || distance < best.distance) best = { name: candidate, pattern, distance };
      }
    }
    searchFrom = emailIndex + normalizedEmail.length;
  }
  return best;
}

function lineBoundPersonNameForFirstEmail(text: string, email: string, domain: string) {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const normalizedEmail = email.trim().toLowerCase();

  const leadingNames = (value: string) => {
    const beforeSeparator = value.split(/\s*[|/–—:]\s*/)[0]?.trim() ?? "";
    const tokens = [...beforeSeparator.matchAll(/\b[A-Z][A-Za-z'’.-]*\b/g)].map((match) => match[0]);
    const candidates: string[] = [];
    for (const length of [2, 3]) {
      if (tokens.length < length) continue;
      candidates.push(cleanName(tokens.slice(0, length).join(" ")));
    }
    return candidates;
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const emailIndex = line.toLowerCase().indexOf(normalizedEmail);
    if (emailIndex < 0) continue;
    const roleContext = lines
      .slice(Math.max(0, index - 3), Math.min(lines.length, index + 2))
      .join(" ");
    if (!hasPersonRoleSignal(roleContext)) continue;

    const fragments: string[] = [];
    const sameLineBefore = line.slice(0, emailIndex).trim();
    if (sameLineBefore) fragments.push(sameLineBefore);
    for (let offset = 1; offset <= 2; offset++) {
      const previous = lines[index - offset];
      if (previous) fragments.push(previous);
    }

    for (const fragment of fragments) {
      for (const candidate of leadingNames(fragment)) {
        if (!looksLikePersonName(candidate) || !emailLooksLikeName(normalizedEmail, candidate)) continue;
        const pattern = deriveEmailPattern(candidate, normalizedEmail, domain);
        if (pattern === "FIRST") return { name: candidate, pattern };
      }
    }
  }
  return null;
}

function publicEmployeeEmailObservations(pages: PageSnapshot[], domain: string) {
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
        reject(`STRUCTURED_PERSON_INVALID_NAME_${classifyRejectedPersonName(name)}`);
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
        reject(`MAILTO_PERSON_ANCHOR_VISIBLE_TEXT_NOT_PERSON_NAME_${classifyRejectedPersonName(name)}`);
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
  observations: PublicEmailPatternObservation[],
  targetingContext: ContactTargetingContext = {}
) {
  const strictEmails = new Set(observations.map((item) => item.email.toLowerCase()));
  const all = [...new Set(pages.flatMap((page) => extractEmails(page.html, domain)))];
  return all.filter((email) => {
    if (strictEmails.has(email.toLowerCase())) return true;
    return rankSharedInboxes([email], targetingContext).length > 0;
  });
}

function inferredEmails(name: string | null, domain: string) {
  if (!name) return [];
  const parts = emailNameParts(name);
  if (!parts) return [];
  const { first, last } = parts;
  return [...new Set([
    `${first}.${last}@${domain}`,
    `${first[0]}${last}@${domain}`,
    `${first}${last}@${domain}`,
    `${first}@${domain}`
  ])];
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

const PUBLIC_PROFILE_HOSTS = new Set([
  "facebook.com","m.facebook.com","instagram.com","linkedin.com","x.com","twitter.com"
]);

function publicProfileHostAllowed(hostname: string) {
  const host = normalizeHost(hostname);
  return [...PUBLIC_PROFILE_HOSTS].some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function extractPublicProfileLinks(html: string, baseUrl: string) {
  const links: string[] = [];
  const push = (raw: string) => {
    try {
      const url = new URL(decodeHtml(raw).trim(), baseUrl);
      if (!/^https?:$/.test(url.protocol) || isIP(url.hostname) || !publicProfileHostAllowed(url.hostname)) return;
      if (normalizeHost(url.hostname).endsWith("linkedin.com") && !/^\/company\//i.test(url.pathname)) return;
      url.hash = "";
      links.push(url.toString());
    } catch {}
  };

  for (const match of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    const href = match[1]?.trim();
    if (href && !/^mailto:|^tel:|^javascript:/i.test(href)) push(href);
  }
  for (const obj of jsonLdObjects(html)) {
    const sameAs = obj.sameAs;
    for (const raw of (Array.isArray(sameAs) ? sameAs : sameAs ? [sameAs] : [])) push(String(raw));
  }
  return [...new Set(links)];
}

async function fetchPublicProfileText(url: string, maxRedirects = 2, deadlineAt: number | null = null): Promise<{ url: string; text: string; contentType: string } | null> {
  let current = new URL(url);
  for (let redirect = 0; redirect <= maxRedirects; redirect++) {
    if (!/^https?:$/.test(current.protocol) || !publicProfileHostAllowed(current.hostname) || isIP(current.hostname)) return null;
    const timeoutMs = deadlineTimeoutMs(deadlineAt);
    if (timeoutMs <= 0) return null;
    const response = await fetch(current, {
      redirect: "manual",
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,text/plain;q=0.9,*/*;q=0.1"
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) return null;
      const next = new URL(location, current);
      if (!publicProfileHostAllowed(next.hostname) || isIP(next.hostname)) return null;
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

function attachPublicProfileEmail(
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

function extractSitemapLinks(xml: string, domain: string) {
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

function jsonLdObjects(html: string) {
  const objects: Record<string, unknown>[] = [];
  const scripts = html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);

  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const obj = value as Record<string, unknown>;
    objects.push(obj);
    for (const nested of Object.values(obj)) {
      if (nested && typeof nested === "object") visit(nested);
    }
  };

  for (const match of scripts) {
    const raw = decodeHtml(match[1] ?? "").trim();
    if (!raw) continue;
    try { visit(JSON.parse(raw)); } catch {}
  }
  return objects;
}

function schemaTypes(value: unknown) {
  return (Array.isArray(value) ? value : [value])
    .map(String)
    .map((item) => item.toLowerCase().replace(/^https?:\/\/schema\.org\//, ""))
    .filter(Boolean);
}

function candidateFromStructuredData(pages: PageSnapshot[], domain: string, approvedTitles: string[], targetingContext: ContactTargetingContext = {}): PublicResearchCandidate | null {
  let best: PublicResearchCandidate | null = null;

  for (const page of pages) {
    for (const obj of jsonLdObjects(page.html)) {
      if (!schemaTypes(obj["@type"]).includes("person")) continue;
      const name = cleanName(String(obj.name ?? ""));
      const rawTitle = String(obj.jobTitle ?? obj.roleName ?? obj.description ?? "").trim();
      if (!looksLikePersonName(name) || !rawTitle) continue;
      const matchedTitle = titleMatches(rawTitle, approvedTitles);
      if (!matchedTitle) continue;
      if (titleHasExternalAffiliation(rawTitle, domain)) continue;

      const rawEmail = String(obj.email ?? "").trim().replace(/^mailto:/i, "").toLowerCase();
      const publishedEmail = rawEmail && hostAllowed(rawEmail.split("@")[1] ?? "", domain) && emailLooksLikeName(rawEmail, name)
        ? rawEmail
        : null;
      const corroboratingPages = corroboratingPageCount(pages, name);
      const path = new URL(page.url).pathname.toLowerCase();
      const leadershipPage = /team|leadership|people|management|staff|about|company/.test(path);
      let decisionMakerConfidence = 90;
      if (leadershipPage) decisionMakerConfidence += 3;
      if (corroboratingPages >= 2) decisionMakerConfidence += 3;
      if (publishedEmail) decisionMakerConfidence += 4;
      decisionMakerConfidence = Math.min(99, decisionMakerConfidence);
      const targeting = scoreContactTarget(matchedTitle, JSON.stringify(obj), page.url, targetingContext);

      const candidate: PublicResearchCandidate = {
        name,
        title: matchedTitle,
        decisionMakerConfidence,
        confidenceGrade: confidenceGrade(decisionMakerConfidence),
        corroboratingPages,
        proximity: "STRUCTURED_DATA",
        sourceKind: page.sourceKind,
        publishedEmail,
        emailConfidence: publishedEmail ? 98 : 0,
        inferredEmailCandidates: publishedEmail || decisionMakerConfidence < HIGH_CONFIDENCE_THRESHOLD ? [] : inferredEmails(name, domain),
        sourceUrl: page.url,
        targetingScore: targeting.score,
        targetingCompanySize: targeting.companySize,
        targetingRoleFunction: targeting.roleFunction,
        targetingSeniority: targeting.seniority,
        targetingLocationMatch: targeting.locationMatch,
        targetingReasons: targeting.reasons,
        evidence: [
          `${name} is declared as a schema.org Person with an approved decision-maker title (${matchedTitle}) on the company website.`,
          leadershipPage ? "The structured identity appears on a leadership/team/about-style company page." : "The structured identity appears on a company-owned page.",
          corroboratingPages >= 2 ? `${name} also appears on ${corroboratingPages} checked company pages.` : `${name} appears on one checked company page.`,
          publishedEmail
            ? `${publishedEmail} is published in company structured data and matches the decision-maker name.`
            : "No person-matching company-domain email was present in the structured data."
        ]
      };

      const strength = candidate.decisionMakerConfidence + candidate.targetingScore + (candidate.publishedEmail ? 12 : 0);
      const bestStrength = best ? best.decisionMakerConfidence + best.targetingScore + (best.publishedEmail ? 12 : 0) : -1;
      if (strength > bestStrength) best = candidate;
    }
  }
  return best;
}

type DetailedFetchResult =
  | { ok: true; value: { url: string; text: string; contentType: string } }
  | { ok: false; reason: string; status: number | null };

async function fetchTextDetailed(url: string, domain: string, maxRedirects = 3, deadlineAt: number | null = null): Promise<DetailedFetchResult> {
  let current: URL;
  try { current = new URL(url); } catch { return { ok: false, reason: "INVALID_URL", status: null }; }
  for (let redirect = 0; redirect <= maxRedirects; redirect++) {
    if (!/^https?:$/.test(current.protocol) || !hostAllowed(current.hostname, domain) || isIP(current.hostname)) return { ok: false, reason: "HOST_OR_PROTOCOL_REJECTED", status: null };
    const timeoutMs = deadlineTimeoutMs(deadlineAt);
    if (timeoutMs <= 0) return { ok: false, reason: "DEADLINE_EXCEEDED", status: null };
    let response: Response;
    try {
      response = await fetch(current, { redirect: "manual", headers: { "user-agent": USER_AGENT, accept: "text/html,text/plain;q=0.9,*/*;q=0.1" }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      return { ok: false, reason: name === "TimeoutError" || name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR", status: null };
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) return { ok: false, reason: "REDIRECT_WITHOUT_LOCATION", status: response.status };
      let next: URL;
      try { next = new URL(location, current); } catch { return { ok: false, reason: "INVALID_REDIRECT", status: response.status }; }
      if (!hostAllowed(next.hostname, domain) || isIP(next.hostname)) return { ok: false, reason: "OFF_DOMAIN_REDIRECT", status: response.status };
      current = next;
      continue;
    }
    if (!response.ok) {
      const reason = response.status === 429 ? "HTTP_429" : response.status >= 500 ? "HTTP_5XX" : response.status >= 400 ? "HTTP_4XX" : "HTTP_OTHER";
      return { ok: false, reason, status: response.status };
    }
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_PAGE_BYTES) return { ok: false, reason: "PAGE_TOO_LARGE", status: response.status };
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    try {
      const text = (await response.text()).slice(0, MAX_PAGE_BYTES);
      return { ok: true, value: { url: current.toString(), text, contentType } };
    } catch { return { ok: false, reason: "BODY_READ_ERROR", status: response.status }; }
  }
  return { ok: false, reason: "REDIRECT_LIMIT", status: null };
}

function isLowValueResearchUrl(value: string) {
  try {
    const path = new URL(value).pathname.toLowerCase();
    return /(?:\/|^)(?:wp-admin|wp-json|feed|feeds|tag|tags|category|categories|search|login|signin|privacy|terms|cart|checkout)(?:\/|$)/.test(path) || /\.(?:jpg|jpeg|png|gif|webp|svg|ico|pdf|zip|docx?|xlsx?|pptx?)(?:$|\?)/.test(path);
  } catch { return true; }
}

function isHighValueResearchUrl(value: string) {
  try {
    const path = new URL(value).pathname.toLowerCase();
    if (/\/(?:news|newsroom|blog|press|media|article|articles|events?|resources?)(?:\/|$)/.test(path)) return false;
    const segments = path.split("/").filter(Boolean);
    return segments.some((segment) => /^(?:team|our-team|leadership|people|our-people|management|staff|staff-directory|directory|executive|executives|officer|officers|owner|owners|founder|founders|about|about-us|contact|contact-us|locations?|branches?|profile|profiles|bio|bios|who-we-are|meet-the-team|meet-our-team)$/.test(segment));
  } catch { return false; }
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

async function fetchText(url: string, domain: string, maxRedirects = 3, deadlineAt: number | null = null): Promise<{ url: string; text: string; contentType: string } | null> {
  let current = new URL(url);
  for (let redirect = 0; redirect <= maxRedirects; redirect++) {
    if (!/^https?:$/.test(current.protocol) || !hostAllowed(current.hostname, domain) || isIP(current.hostname)) return null;
    const timeoutMs = deadlineTimeoutMs(deadlineAt);
    if (timeoutMs <= 0) return null;

    const response = await fetch(current, {
      redirect: "manual",
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,text/plain;q=0.9,*/*;q=0.1"
      },
      signal: AbortSignal.timeout(timeoutMs)
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

function titleHasExternalAffiliation(value: string, domain: string) {
  const match = value.match(/\bof\s+(?:the\s+)?([A-Za-z0-9&.'’ -]{3,100})/i);
  if (!match) return false;
  const affiliation = normalizeNameToken(match[1] ?? "");
  const brand = normalizeNameToken(normalizeDomain(domain).split(".")[0] ?? "");
  if (!affiliation || !brand) return false;
  return !affiliation.includes(brand) && !brand.includes(affiliation);
}

function looksLikeExternalOrganizationLabel(value: string, domain: string) {
  const text = decodeHtml(value).replace(/\s+/g, " ").trim();
  if (!text || text.length > 100 || looksLikePersonName(text)) return false;
  const normalized = normalizeTitle(text);
  const brand = normalizeNameToken(normalizeDomain(domain).split(".")[0] ?? "");
  if (!normalized || (brand && normalizeNameToken(normalized).includes(brand))) return false;
  return /\b(?:inc|llc|company|corp|corporation|group|shop|bakery|university|college|school|stadium|restaurant|customs|services|solutions|systems|mechanical|plumbing|roofing|heating|cooling|hvac|landscape|landscaping|cleaning|partners|associates|agency|hospital|clinic|hotel|club|church|bank|supply)\b/i.test(normalized);
}

function extractFullNameMentions(text: string) {
  const matches = [...text.matchAll(/\b([A-Z][A-Za-z'’.-]{1,30})\s+([A-Z][A-Za-z'’.-]{1,40})\b/g)];
  return matches
    .map((match) => ({ first: match[1], last: match[2], full: `${match[1]} ${match[2]}` }))
    .filter((item) => looksLikePersonName(item.full));
}

function resolveGivenNameFromFamilyContext(givenName: string, pageText: string) {
  const normalizedGiven = givenName.toLowerCase();
  const names = extractFullNameMentions(pageText);
  const direct = names.find((item) => item.first.toLowerCase() === normalizedGiven);
  if (direct) return { name: direct.full, reason: "DIRECT_FULL_NAME_ON_PAGE" };

  const surnameVotes = new Map<string, number>();
  const vote = (surname: string) => surnameVotes.set(surname, (surnameVotes.get(surname) ?? 0) + 1);
  for (const item of names) {
    const escapedFull = escapeRegex(item.full);
    const escapedGiven = escapeRegex(givenName);
    const childOfGiven = new RegExp(`${escapedFull}[^.!?]{0,60}${escapedGiven}[’']s\s+(?:son|daughter)`, "i");
    if (childOfGiven.test(pageText)) vote(item.last);

    const escapedFirst = escapeRegex(item.first);
    const givenChildOfNamedParent = new RegExp(`${escapedGiven}[^.!?]{0,80}${escapedFirst}[’']s\s+(?:son|daughter)`, "i");
    if (givenChildOfNamedParent.test(pageText)) vote(item.last);
  }
  const ranked = [...surnameVotes.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return null;
  return { name: `${givenName} ${ranked[0][0]}`, reason: "EXPLICIT_FAMILY_RELATIONSHIP" };
}

function proseNameForTitle(line: string, matchedTitle: string, pageText: string) {
  const exactTitlePattern = new RegExp(escapeRegex(matchedTitle), "i");
  const exactTitleIndex = line.search(exactTitlePattern);
  if (exactTitleIndex < 0) return null;
  const before = line.slice(Math.max(0, exactTitleIndex - 140), exactTitleIndex);
  const patterns = [
    /(?:^|[.!?]\s+)(?:In\s+\d{4}\s+)?([A-Z][A-Za-z'’.-]{1,30})\s+(?:became|is|serves\s+as|was\s+named|was\s+appointed|was\s+promoted\s+to)\s+(?:the\s+)?$/i,
    /(?:^|[.!?]\s+)([A-Z][A-Za-z'’.-]{1,30}),\s+(?:the\s+)?current\s+$/i
  ];
  for (const pattern of patterns) {
    const match = before.match(pattern);
    const given = match?.[1];
    if (!given) continue;
    const resolved = resolveGivenNameFromFamilyContext(given, pageText);
    if (resolved && looksLikePersonName(resolved.name)) return resolved;
  }
  return null;
}

function candidateFromPages(pages: PageSnapshot[], domain: string, approvedTitles: string[], emailPatternObservations: PublicEmailPatternObservation[] = [], targetingContext: ContactTargetingContext = {}): PublicResearchCandidate | null {
  let best: PublicResearchCandidate | null = null;

  for (const page of pages) {
    const lines = page.text.split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 5000);

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const matchedTitle = titleMatches(line, approvedTitles);
      if (!matchedTitle) continue;
      if (titleHasExternalAffiliation(line, domain)) continue;

      const normalizedMatchedTitle = normalizeTitle(matchedTitle);
      const exactTitlePattern = new RegExp(escapeRegex(matchedTitle), "i");
      const exactTitleIndex = line.search(exactTitlePattern);
      const beforeExactTitle = exactTitleIndex > 0 ? cleanName(line.slice(0, exactTitleIndex)) : "";
      const sameLineWithoutTitle = cleanName(
        normalizeTitle(line).includes(normalizedMatchedTitle)
          ? line.replace(exactTitlePattern, " ")
          : line
      );

      // Prefer a person-like name immediately before the title. This avoids
      // absorbing trailing organization text from constructions like
      // "Keith Ordan, CEO, Brilliant" while preserving "CEO: Jane Smith"
      // through the existing whole-line fallback.
      const sameLineName = looksLikePersonName(beforeExactTitle)
        ? beforeExactTitle
        : looksLikePersonName(sameLineWithoutTitle)
          ? sameLineWithoutTitle
          : null;
      const adjacentName = [lines[index - 1], lines[index + 1]]
        .filter((value): value is string => Boolean(value))
        .map(cleanName)
        .find(looksLikePersonName) ?? null;
      const proseResolved = !sameLineName && !adjacentName ? proseNameForTitle(line, matchedTitle, page.text) : null;
      const name = sameLineName ?? adjacentName ?? proseResolved?.name ?? null;
      if (!name) continue;
      if (sameLineName && looksLikeExternalOrganizationLabel(lines[index + 1] ?? "", domain)) continue;

      const proximity: "SAME_LINE" | "ADJACENT_LINE" = sameLineName || proseResolved ? "SAME_LINE" : "ADJACENT_LINE";
      const corroboratingPages = corroboratingPageCount(pages, name);
      const nameEmail = strictPublishedObservationForName(emailPatternObservations, name)?.email ?? null;
      const publishedEmail = nameEmail;
      const path = new URL(page.url).pathname.toLowerCase();
      const leadershipPage = /team|leadership|people|management|staff|about|contact/.test(path);

      // Adjacent text is much noisier than a same-line name/title pair. It can
      // still become HIGH confidence when a person-matching published email
      // corroborates it, but page placement + repetition alone is not enough.
      let decisionMakerConfidence = proximity === "SAME_LINE" ? 82 : 68;
      if (leadershipPage) decisionMakerConfidence += 8;
      if (corroboratingPages >= 2) decisionMakerConfidence += 7;
      if (nameEmail) decisionMakerConfidence += 10;
      if (!leadershipPage && !nameEmail) decisionMakerConfidence = Math.min(decisionMakerConfidence, 79);
      decisionMakerConfidence = Math.min(99, decisionMakerConfidence);

      const grade = confidenceGrade(decisionMakerConfidence);
      const emailConfidence = publishedEmail ? 96 : 0;
      const evidence = [
        proseResolved
          ? `${name} is resolved from an explicit title statement (${matchedTitle}) plus ${proseResolved.reason === "EXPLICIT_FAMILY_RELATIONSHIP" ? "a same-page family relationship" : "a full-name mention"} on ${path || "/"}.`
          : `${name} appears ${proximity === "SAME_LINE" ? "on the same line as" : "directly beside"} an approved decision-maker title (${matchedTitle}) on ${path || "/"}.`,
        leadershipPage ? "The evidence comes from a leadership/team/about-style company page." : "The evidence comes from a general company page.",
        corroboratingPages >= 2 ? `${name} appears on ${corroboratingPages} checked company pages.` : `${name} appears on one checked company page.`,
        publishedEmail
          ? `${publishedEmail} is published with an exact Person JSON-LD or person-named mailto binding.`
          : "No person-matching decision-maker email was published on the checked pages."
      ];
      const contextText = lines.slice(Math.max(0, index - 3), Math.min(lines.length, index + 4)).join("\n");
      const targeting = scoreContactTarget(matchedTitle, contextText, page.url, targetingContext);

      const candidate: PublicResearchCandidate = {
        name,
        title: matchedTitle,
        decisionMakerConfidence,
        confidenceGrade: grade,
        corroboratingPages,
        proximity,
        sourceKind: page.sourceKind,
        publishedEmail,
        emailConfidence,
        inferredEmailCandidates: publishedEmail || decisionMakerConfidence < HIGH_CONFIDENCE_THRESHOLD ? [] : inferredEmails(name, domain),
        sourceUrl: page.url,
        targetingScore: targeting.score,
        targetingCompanySize: targeting.companySize,
        targetingRoleFunction: targeting.roleFunction,
        targetingSeniority: targeting.seniority,
        targetingLocationMatch: targeting.locationMatch,
        targetingReasons: targeting.reasons,
        evidence
      };

      const candidateStrength = candidate.decisionMakerConfidence + candidate.targetingScore + (candidate.publishedEmail ? 12 : 0);
      const bestStrength = best ? best.decisionMakerConfidence + best.targetingScore + (best.publishedEmail ? 12 : 0) : -1;
      if (candidateStrength > bestStrength) best = candidate;
    }
  }

  return best;
}

export function publicResearchEnabled() {
  return process.env.CONNECT_PUBLIC_RESEARCH_ENABLED !== "false";
}

export async function researchPublicCompanySite(
  domainValue: string,
  approvedTitles: string[],
  segmentSlug?: string | null,
  targetIndustries: string[] = [],
  options: PublicResearchOptions = {}
): Promise<PublicResearchResult> {
  const domain = normalizeDomain(domainValue);
  if (!publicResearchEnabled()) {
    return { status: "BLOCKED", domain, candidate: null, publishedEmails: [], emailPatternObservations: [], pagesChecked: [], robotsRespected: true, error: "Public research is disabled." };
  }
  if (!validPublicDomain(domain)) {
    return { status: "BLOCKED", domain, candidate: null, publishedEmails: [], emailPatternObservations: [], pagesChecked: [], robotsRespected: true, error: "Invalid or non-public domain." };
  }

  const configuredDeadlineMs = Number(options.deadlineMs);
  const deadlineAt = Number.isFinite(configuredDeadlineMs) && configuredDeadlineMs > 0
    ? Date.now() + Math.max(1_000, Math.min(120_000, Math.floor(configuredDeadlineMs)))
    : null;
  const deadlineReached = () => deadlineAt !== null && Date.now() >= deadlineAt;
  const targetingContext: ContactTargetingContext = {
    targetCity: options.targetCity ?? null,
    targetState: options.targetState ?? null,
    employeeCount: options.employeeCount ?? null,
    locationCount: options.locationCount ?? null
  };
  const targetTitles = expandDecisionMakerTitles(approvedTitles);

  try {
    let robotsDisallow: string[] = [];
    try {
      const robots = await fetchText(`https://${domain}/robots.txt`, domain, 3, deadlineAt);
      if (robots) robotsDisallow = parseRobots(robots.text);
    } catch {}

    if (robotsDisallow.includes("/")) {
      return { status: "BLOCKED", domain, candidate: null, publishedEmails: [], emailPatternObservations: [], pagesChecked: [], robotsRespected: true, error: "robots.txt disallows crawling." };
    }

    const queue = [
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
      fetchFailureReasons: {} as Record<string, number>,
      fetchFailureStatusCodes: {} as Record<string, number>,
      fetchFailureSamples: [] as Array<{ url: string; reason: string; status: number | null }>,
      lowValueUrlsSkipped: 0,
      highValueUrlsPrioritized: 0,
      contentTypeRejected: 0,
      deadlineExceeded: false
    };
    const recordFetchFailure = (url: string, failure: { reason: string; status: number | null }) => {
      pageDiscovery.fetchFailures++;
      pageDiscovery.fetchFailureReasons[failure.reason] = (pageDiscovery.fetchFailureReasons[failure.reason] ?? 0) + 1;
      if (failure.status !== null) { const status = String(failure.status); pageDiscovery.fetchFailureStatusCodes[status] = (pageDiscovery.fetchFailureStatusCodes[status] ?? 0) + 1; }
      if (pageDiscovery.fetchFailureSamples.length < 12) pageDiscovery.fetchFailureSamples.push({ url, reason: failure.reason, status: failure.status });
      if (failure.reason === "DEADLINE_EXCEEDED") pageDiscovery.deadlineExceeded = true;
    };
    const enqueue = (url: string, sourceKind: "SITEMAP" | "INTERNAL") => {
      if (queued.has(url)) return;
      if (isLowValueResearchUrl(url)) { pageDiscovery.lowValueUrlsSkipped++; queued.add(url); return; }
      queued.add(url);
      if (isHighValueResearchUrl(url)) { queue.unshift(url); pageDiscovery.highValueUrlsPrioritized++; } else queue.push(url);
      if (sourceKind === "SITEMAP") pageDiscovery.sitemapUrlsDiscovered++;
      else pageDiscovery.internalUrlsDiscovered++;
    };

    if (options.expanded) {
      for (const sitemapUrl of [`https://${domain}/sitemap.xml`, `https://${domain}/wp-sitemap.xml`]) {
        if (deadlineReached()) break;
        const sitemapFetch = await fetchTextDetailed(sitemapUrl, domain, 3, deadlineAt);
        if (!sitemapFetch.ok) { recordFetchFailure(sitemapUrl, sitemapFetch); continue; }
        for (const discovered of extractSitemapLinks(sitemapFetch.value.text, domain).slice(0, 60)) enqueue(discovered, "SITEMAP");
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

      const fetchResult = await fetchTextDetailed(next, domain, 3, deadlineAt);
      if (!fetchResult.ok) { recordFetchFailure(next, fetchResult); continue; }
      const fetched = fetchResult.value;
      let fetchedUrl: URL;
      try { fetchedUrl = new URL(fetched.url); } catch { continue; }
      const fetchedKey = `${fetchedUrl.protocol}//${normalizeHost(fetchedUrl.hostname)}${fetchedUrl.pathname}`.replace(/\/$/, "") || domain;
      if (fetchedKey !== key && visited.has(fetchedKey)) continue;
      visited.add(fetchedKey);
      if (pages.some((page) => {
        try {
          const pageUrl = new URL(page.url);
          const pageKey = `${pageUrl.protocol}//${normalizeHost(pageUrl.hostname)}${pageUrl.pathname}`.replace(/\/$/, "") || domain;
          return pageKey === fetchedKey;
        } catch { return false; }
      })) continue;
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

    const profilePages: PageSnapshot[] = [];
    if (options.includePublicProfiles) {
      const profileLinks = [...new Set(pages.flatMap((page) => extractPublicProfileLinks(page.html, page.url)))].slice(0, 3);
      pageDiscovery.profileUrlsDiscovered = profileLinks.length;
      for (const profileUrl of profileLinks) {
        if (deadlineReached()) break;
        try {
          const fetched = await fetchPublicProfileText(profileUrl, 2, deadlineAt);
          if (!fetched || (fetched.contentType && !fetched.contentType.includes("text/html") && !fetched.contentType.includes("text/plain"))) continue;
          profilePages.push({
            url: fetched.url,
            html: fetched.text,
            text: htmlToText(fetched.text),
            sourceKind: "PUBLIC_PROFILE"
          });
          pageDiscovery.profilePagesFetched = profilePages.length;
        } catch {}
      }
    }

    const allEvidencePages = [...pages, ...profilePages];
    const patternScan = publicEmployeeEmailObservations(allEvidencePages, domain);
    const emailPatternObservations = patternScan.observations;
    const publishedEmails = publishedCompanyEmailsForStorage(allEvidencePages, domain, emailPatternObservations, targetingContext);
    const sharedInboxCandidates = rankSharedInboxes(publishedEmails, targetingContext);
    const textCandidate = candidateFromPages(allEvidencePages, domain, targetTitles, emailPatternObservations, targetingContext);
    const structuredCandidate = candidateFromStructuredData(allEvidencePages, domain, targetTitles, targetingContext);
    const baseCandidate = [structuredCandidate, textCandidate]
      .filter((item): item is PublicResearchCandidate => Boolean(item))
      .sort((a, b) => (b.decisionMakerConfidence + b.targetingScore + (b.publishedEmail ? 12 : 0)) - (a.decisionMakerConfidence + a.targetingScore + (a.publishedEmail ? 12 : 0)))[0] ?? null;
    const candidate = attachPublicProfileEmail(baseCandidate, emailPatternObservations);
    const serviceFit = evaluateConnectServiceFit(segmentSlug, pages, targetIndustries);
    const deadlineExceeded = deadlineReached();
    pageDiscovery.deadlineExceeded = deadlineExceeded;
    const diagnostics: PublicResearchDiagnostics = {
      pageDiscovery,
      publicEmailBindings: patternScan.diagnostics
    };
    return {
      status: candidate ? "CANDIDATE_FOUND" : deadlineExceeded ? "ERROR" : "NO_MATCH",
      domain,
      candidate,
      publishedEmails,
      emailPatternObservations,
      sharedInboxCandidates,
      diagnostics,
      pagesChecked: allEvidencePages.map((page) => page.url),
      robotsRespected: true,
      serviceFit,
      ...(deadlineExceeded && !candidate ? { error: "Public research reached its configured deadline." } : {})
    };
  } catch (error) {
    return {
      status: "ERROR",
      domain,
      candidate: null,
      publishedEmails: [],
      emailPatternObservations: [],
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
    `SELECT id,domain,company_name,contact_name,contact_title,source,city,state,employee_count,location_count
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
         OR (
           source='ARBORLINE_DISCOVERY'
           AND coalesce(source_metadata->'service_fit'->>'status','')=''
         )
       )
       AND contact_email IS NULL
       AND domain IS NOT NULL
       AND (
         NOT (coalesce(source_metadata,'{}'::jsonb) ? 'public_research_checked_at')
         OR (
           source='ARBORLINE_DISCOVERY'
           AND coalesce(source_metadata->'service_fit'->>'status','')=''
         )
       )
     ORDER BY CASE
                WHEN source='ARBORLINE_DISCOVERY'
                 AND coalesce(source_metadata->'service_fit'->>'status','')=''
                THEN 0 ELSE 1
              END ASC,
              qualification_score DESC NULLS LAST,created_at ASC
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
    const result = await researchPublicCompanySite(
      String(row.domain),
      titles,
      segmentId ? String(profile.rows[0]?.slug ?? "") : null,
      segmentId && Array.isArray(profile.rows[0]?.target_industries) ? profile.rows[0].target_industries.map(String) : [],
      {
        targetCity: row.city ?? null,
        targetState: row.state ?? null,
        employeeCount: row.employee_count ?? null,
        locationCount: row.location_count ?? null
      }
    );
    if (result.status === "BLOCKED") blocked++;
    if (result.status === "ERROR") errors++;
    if (result.candidate) candidates++;
    if (result.candidate?.confidenceGrade === "HIGH") highConfidenceCandidates++;
    if (result.candidate?.publishedEmail) publishedEmailCandidates++;

    const candidate = result.candidate;
    const checkedAt = new Date().toISOString();
    const metadata = {
      public_research_checked_at: checkedAt,
      service_fit_checked_at: checkedAt,
      service_fit: result.serviceFit ?? {
        status: "UNVERIFIED",
        matchedTerms: [],
        commercialSignals: [],
        mismatchSignals: [],
        pagesMatched: [],
        evidence: ["Service fit was not available for this research result."]
      },
      public_research: {
        status: result.status,
        domain: result.domain,
        diagnostics: result.diagnostics ?? null,
        decision_maker_name: candidate?.name ?? null,
        decision_maker_title: candidate?.title ?? null,
        decision_maker_confidence: candidate?.decisionMakerConfidence ?? 0,
        decision_maker_confidence_grade: candidate?.confidenceGrade ?? "LOW",
        decision_maker_corroborating_pages: candidate?.corroboratingPages ?? 0,
        decision_maker_proximity: candidate?.proximity ?? null,
        targeting_model_version: "LOCATION_FUNCTION_V1",
        targeting_score: candidate?.targetingScore ?? 0,
        targeting_company_size: candidate?.targetingCompanySize ?? null,
        targeting_role_function: candidate?.targetingRoleFunction ?? null,
        targeting_seniority: candidate?.targetingSeniority ?? null,
        targeting_location_match: candidate?.targetingLocationMatch ?? null,
        targeting_reasons: candidate?.targetingReasons ?? [],
        shared_inbox_candidates: result.sharedInboxCandidates ?? [],
        published_email: candidate?.publishedEmail ?? null,
        email_status: candidate?.publishedEmail ? "PUBLISHED_UNVERIFIED" : candidate?.inferredEmailCandidates.length ? "INFERRED_UNVERIFIED" : "NONE",
        email_confidence: candidate?.emailConfidence ?? 0,
        inferred_email_candidates: candidate?.inferredEmailCandidates ?? [],
        published_company_emails: result.publishedEmails.slice(0, 12),
        public_email_pattern_observations: result.emailPatternObservations.slice(0, 20),
        source_url: candidate?.sourceUrl ?? null,
        pages_checked: result.pagesChecked.slice(0, MAX_PAGES),
        evidence: candidate?.evidence ?? [],
        robots_respected: result.robotsRespected,
        error: result.error ?? null
      }
    };

    await pool.query(
      `UPDATE connect_prospects
       SET contact_name=CASE WHEN contact_name IS NULL AND $2::text IS NOT NULL AND $4::int >= $6::int AND $7::boolean THEN $2 ELSE contact_name END,
           contact_title=CASE WHEN contact_title IS NULL AND $3::text IS NOT NULL AND $4::int >= $6::int AND $7::boolean THEN $3 ELSE contact_title END,
           source_metadata=coalesce(source_metadata,'{}'::jsonb) || $5::jsonb,
           updated_at=now()
       WHERE id=$1`,
      [row.id, candidate?.name ?? null, candidate?.title ?? null, candidate?.decisionMakerConfidence ?? 0, JSON.stringify(metadata), HIGH_CONFIDENCE_THRESHOLD, row.source !== "ARBORLINE_DISCOVERY" || result.serviceFit?.status === "MATCH"]
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
          industry_fit_status: current.source === "ARBORLINE_DISCOVERY" ? (result.serviceFit?.status ?? "UNVERIFIED") : null,
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
