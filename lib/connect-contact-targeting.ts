export type ContactTargetingContext = {
  targetCity?: string | null;
  targetState?: string | null;
  employeeCount?: number | null;
  locationCount?: number | null;
};

export type ContactCompanySize = "SMALL" | "MID" | "LARGE" | "UNKNOWN";
export type ContactRoleFunction =
  | "BRANCH_REGIONAL"
  | "OPERATIONS"
  | "SERVICE"
  | "COMMERCIAL"
  | "BUSINESS_DEVELOPMENT"
  | "SALES"
  | "SAFETY"
  | "EXECUTIVE"
  | "OTHER";
export type ContactSeniority = "C_SUITE" | "VP" | "DIRECTOR" | "MANAGER" | "OWNER_EXEC" | "OTHER";
export type ContactLocationMatch = "TARGET_CITY" | "TARGET_STATE" | "SINGLE_LOCATION" | "UNKNOWN";

export type ContactTargetScore = {
  score: number;
  companySize: ContactCompanySize;
  roleFunction: ContactRoleFunction;
  seniority: ContactSeniority;
  locationMatch: ContactLocationMatch;
  reasons: string[];
};

export type SharedInboxCandidate = {
  email: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  score: number;
  function: string;
  locationMatch: boolean;
  reasons: string[];
};

const TARGETING_TITLES = [
  "Branch Manager",
  "Branch Operations Manager",
  "Area Manager",
  "District Manager",
  "Market Manager",
  "Regional Manager",
  "Regional Director",
  "Regional Operations Manager",
  "Regional Operations Director",
  "General Manager",
  "Operations Manager",
  "Director of Operations",
  "VP Operations",
  "Vice President of Operations",
  "COO",
  "Chief Operating Officer",
  "Service Manager",
  "Service Director",
  "Commercial Manager",
  "Commercial Sales Manager",
  "Commercial Director",
  "Estimating Manager",
  "Director of Estimating",
  "Business Development Manager",
  "Director of Business Development",
  "VP Business Development",
  "Vice President of Business Development",
  "Sales Manager",
  "Sales Director",
  "VP Sales",
  "Vice President of Sales",
  "Safety Manager",
  "Safety Director",
  "EHS Manager",
  "EHS Director"
] as const;

const US_STATE_NAMES_BY_CODE: Record<string, string> = {
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado",
  CT: "connecticut", DE: "delaware", FL: "florida", GA: "georgia", HI: "hawaii", ID: "idaho",
  IL: "illinois", IN: "indiana", IA: "iowa", KS: "kansas", KY: "kentucky", LA: "louisiana",
  ME: "maine", MD: "maryland", MA: "massachusetts", MI: "michigan", MN: "minnesota", MS: "mississippi",
  MO: "missouri", MT: "montana", NE: "nebraska", NV: "nevada", NH: "new hampshire", NJ: "new jersey",
  NM: "new mexico", NY: "new york", NC: "north carolina", ND: "north dakota", OH: "ohio", OK: "oklahoma",
  OR: "oregon", PA: "pennsylvania", RI: "rhode island", SC: "south carolina", SD: "south dakota",
  TN: "tennessee", TX: "texas", UT: "utah", VT: "vermont", VA: "virginia", WA: "washington",
  WV: "west virginia", WI: "wisconsin", WY: "wyoming", DC: "district of columbia"
};

const STATE_CODE_BY_NAME = Object.fromEntries(
  Object.entries(US_STATE_NAMES_BY_CODE).map(([code, name]) => [name, code])
) as Record<string, string>;

const normalize = (value: string | null | undefined) => String(value ?? "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const compact = (value: string | null | undefined) => normalize(value).replace(/\s+/g, "");

export function expandDecisionMakerTitles(approvedTitles: string[]) {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const title of [...TARGETING_TITLES, ...approvedTitles]) {
    const value = String(title ?? "").trim();
    const key = normalize(value);
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    merged.push(value);
  }
  return merged;
}

export function companySizeForTargeting(context: ContactTargetingContext): ContactCompanySize {
  const employees = Number(context.employeeCount);
  if (Number.isFinite(employees) && employees > 0) {
    if (employees < 50) return "SMALL";
    if (employees < 200) return "MID";
    return "LARGE";
  }
  if (Number(context.locationCount) > 1) return "MID";
  return "UNKNOWN";
}

export function classifyRoleFunction(title: string): ContactRoleFunction {
  const value = normalize(title);
  if (/\b(branch|regional|region|district|area|market)\b/.test(value)) return "BRANCH_REGIONAL";
  if (/\b(operation|operations|operational)\b/.test(value) || /\bcoo\b/.test(value) || value.includes("chief operating officer")) return "OPERATIONS";
  if (/\b(service|field service)\b/.test(value)) return "SERVICE";
  if (/\b(commercial|estimating|estimator|strategic account|national account)\b/.test(value)) return "COMMERCIAL";
  if (/\b(business development|growth|partnerships)\b/.test(value)) return "BUSINESS_DEVELOPMENT";
  if (/\b(sales|revenue|account executive|account manager)\b/.test(value)) return "SALES";
  if (/\b(safety|ehs|hse|environmental health|health and safety)\b/.test(value)) return "SAFETY";
  if (/\b(owner|founder|president|chief executive|ceo|managing partner|managing director)\b/.test(value)) return "EXECUTIVE";
  if (/\bgeneral manager\b/.test(value)) return "BRANCH_REGIONAL";
  return "OTHER";
}

export function classifySeniority(title: string): ContactSeniority {
  const value = normalize(title);
  if (/\b(ceo|coo|cfo|cto|chief)\b/.test(value)) return "C_SUITE";
  if (/\b(vice president|vp)\b/.test(value)) return "VP";
  if (/\b(director)\b/.test(value)) return "DIRECTOR";
  if (/\b(manager|supervisor|head)\b/.test(value)) return "MANAGER";
  if (/\b(owner|founder|president|managing partner|managing director)\b/.test(value)) return "OWNER_EXEC";
  return "OTHER";
}

function sourceContainsCity(sourceText: string, city: string | null | undefined) {
  const haystack = ` ${normalize(sourceText)} `;
  const needle = normalize(city);
  return Boolean(needle && haystack.includes(` ${needle} `));
}

function stateAliases(state: string | null | undefined) {
  const raw = String(state ?? "").trim();
  const normalized = normalize(raw);
  if (!normalized) return { name: "", code: "" };
  const upper = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper) && US_STATE_NAMES_BY_CODE[upper]) {
    return { name: US_STATE_NAMES_BY_CODE[upper], code: upper };
  }
  return { name: normalized, code: STATE_CODE_BY_NAME[normalized] ?? "" };
}

function sourceContainsState(sourceText: string, state: string | null | undefined) {
  const { name, code } = stateAliases(state);
  if (!name) return false;

  const normalizedSource = ` ${normalize(sourceText)} `;
  if (normalizedSource.includes(` ${name} `)) return true;
  if (!code) return false;

  // Postal abbreviations are accepted only in address/route-like formatting.
  // This avoids treating ordinary words such as "in", "or", and "me" as states.
  const escapedCode = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const addressCode = new RegExp(`(?:,\\s*|\\b)(?:${escapedCode})(?=\\s+\\d{5}(?:-\\d{4})?\\b|\\s*[,|•·–—]\\s*|\\s*$)`, "m");
  if (addressCode.test(sourceText)) return true;

  const urlish = sourceText.toLowerCase();
  return new RegExp(`(?:/|-|_)${code.toLowerCase()}(?:/|-|_|$)`).test(urlish);
}

function locationSensitiveCompany(companySize: ContactCompanySize, context: ContactTargetingContext) {
  const locations = Number(context.locationCount);
  if (locations === 1) return false;
  if (locations > 1) return true;
  return companySize === "MID" || companySize === "LARGE";
}

export function scoreContactTarget(
  title: string,
  sourceText: string,
  sourceUrl: string,
  context: ContactTargetingContext = {}
): ContactTargetScore {
  const companySize = companySizeForTargeting(context);
  const roleFunction = classifyRoleFunction(title);
  const seniority = classifySeniority(title);
  const source = `${sourceText}\n${sourceUrl}`;
  const cityMatch = sourceContainsCity(source, context.targetCity);
  const stateMatch = sourceContainsState(source, context.targetState);
  const singleLocation = Number(context.locationCount) === 1;
  const explicitMultiLocation = Number(context.locationCount) > 1;
  const locationSensitive = locationSensitiveCompany(companySize, context);

  const baseBySize: Record<ContactCompanySize, Record<ContactRoleFunction, number>> = {
    SMALL: {
      BRANCH_REGIONAL: 94,
      OPERATIONS: 94,
      SERVICE: 88,
      COMMERCIAL: 91,
      BUSINESS_DEVELOPMENT: 91,
      SALES: 90,
      SAFETY: 82,
      EXECUTIVE: 98,
      OTHER: 72
    },
    MID: {
      BRANCH_REGIONAL: 98,
      OPERATIONS: 97,
      SERVICE: 92,
      COMMERCIAL: 95,
      BUSINESS_DEVELOPMENT: 96,
      SALES: 94,
      SAFETY: 86,
      EXECUTIVE: 82,
      OTHER: 70
    },
    LARGE: {
      BRANCH_REGIONAL: 99,
      OPERATIONS: 98,
      SERVICE: 93,
      COMMERCIAL: 96,
      BUSINESS_DEVELOPMENT: 97,
      SALES: 95,
      SAFETY: 88,
      EXECUTIVE: 72,
      OTHER: 68
    },
    UNKNOWN: {
      BRANCH_REGIONAL: 96,
      OPERATIONS: 95,
      SERVICE: 90,
      COMMERCIAL: 93,
      BUSINESS_DEVELOPMENT: 94,
      SALES: 92,
      SAFETY: 84,
      EXECUTIVE: 90,
      OTHER: 70
    }
  };

  let score = baseBySize[companySize][roleFunction];
  const reasons = [`${roleFunction.toLowerCase().replace(/_/g, " ")} role scored for a ${companySize.toLowerCase()} company.`];
  let locationMatch: ContactLocationMatch = "UNKNOWN";

  if (cityMatch) {
    const localityBonus = locationSensitive
      ? roleFunction === "BRANCH_REGIONAL" || roleFunction === "OPERATIONS" ? 16 : 12
      : 8;
    score += localityBonus;
    locationMatch = "TARGET_CITY";
    reasons.push(`Public evidence ties the contact context to ${context.targetCity}.`);
  } else if (stateMatch) {
    const localityBonus = locationSensitive
      ? roleFunction === "BRANCH_REGIONAL" || roleFunction === "OPERATIONS" ? 10 : 7
      : 4;
    score += localityBonus;
    locationMatch = "TARGET_STATE";
    reasons.push(`Public evidence ties the contact context to ${context.targetState}.`);
  } else if (singleLocation) {
    score += 4;
    locationMatch = "SINGLE_LOCATION";
    reasons.push("The prospect is recorded as a single-location company, reducing branch mismatch risk.");
  } else if (locationSensitive) {
    reasons.push(
      explicitMultiLocation
        ? "The prospect has multiple locations and no target-location match was found for this contact."
        : "The company is mid/large with no explicit single-location evidence, so ArborLine requires stronger geographic relevance."
    );
    if (roleFunction === "EXECUTIVE") score -= companySize === "LARGE" ? 10 : 7;
    else if (seniority === "C_SUITE" || seniority === "VP") score -= 5;
    else if (roleFunction === "OTHER") score -= 4;
  }

  if ((companySize === "MID" || companySize === "LARGE") && roleFunction === "EXECUTIVE") {
    reasons.push("Corporate executive seniority is intentionally de-emphasized for larger companies when operating leaders are available.");
  }
  if (locationSensitive && (roleFunction === "BRANCH_REGIONAL" || roleFunction === "OPERATIONS") && locationMatch !== "UNKNOWN") {
    reasons.push("Function plus geography is prioritized over corporate seniority for location-sensitive companies.");
  } else if (roleFunction === "BRANCH_REGIONAL" || roleFunction === "OPERATIONS") {
    reasons.push("ArborLine prioritizes leaders close to day-to-day commercial and operating needs.");
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    companySize,
    roleFunction,
    seniority,
    locationMatch,
    reasons
  };
}

const HIGH_SHARED_FUNCTIONS: Record<string, string> = {
  operations: "OPERATIONS",
  operation: "OPERATIONS",
  ops: "OPERATIONS",
  commercial: "COMMERCIAL",
  commercialsales: "COMMERCIAL_SALES",
  sales: "SALES",
  service: "SERVICE",
  estimating: "ESTIMATING",
  estimates: "ESTIMATING",
  estimator: "ESTIMATING",
  businessdevelopment: "BUSINESS_DEVELOPMENT",
  bizdev: "BUSINESS_DEVELOPMENT",
  bd: "BUSINESS_DEVELOPMENT",
  branch: "BRANCH",
  regional: "REGIONAL",
  growth: "GROWTH",
  safety: "SAFETY",
  ehs: "EHS"
};

const MEDIUM_SHARED_FUNCTIONS: Record<string, string> = {
  team: "TEAM",
  office: "OFFICE",
  general: "GENERAL",
  management: "MANAGEMENT",
  managers: "MANAGEMENT"
};

const LOW_SHARED_FUNCTIONS: Record<string, string> = {
  info: "INFO",
  contact: "CONTACT",
  hello: "HELLO",
  admin: "ADMIN"
};

const BLOCKED_SHARED_LOCAL_PARTS = new Set([
  "billing", "accounting", "accounts", "accountspayable", "accountsreceivable", "ap", "ar",
  "careers", "jobs", "hr", "humanresources", "support", "techsupport", "marketing", "press",
  "media", "legal", "privacy", "abuse", "webmaster", "noreply", "no-reply"
]);

function sharedFunction(localPart: string) {
  const key = compact(localPart);
  if (!key || BLOCKED_SHARED_LOCAL_PARTS.has(key)) return null;
  if (HIGH_SHARED_FUNCTIONS[key]) return { priority: "HIGH" as const, score: 90, function: HIGH_SHARED_FUNCTIONS[key] };
  if (MEDIUM_SHARED_FUNCTIONS[key]) return { priority: "MEDIUM" as const, score: 70, function: MEDIUM_SHARED_FUNCTIONS[key] };
  if (LOW_SHARED_FUNCTIONS[key]) return { priority: "LOW" as const, score: 50, function: LOW_SHARED_FUNCTIONS[key] };

  for (const [token, fn] of Object.entries(HIGH_SHARED_FUNCTIONS)) {
    if (key.startsWith(token) || key.endsWith(token)) return { priority: "HIGH" as const, score: 86, function: fn };
  }
  return null;
}

export function rankSharedInboxes(emails: string[], context: ContactTargetingContext = {}): SharedInboxCandidate[] {
  const cityKey = compact(context.targetCity);
  const { name: stateName, code: stateCode } = stateAliases(context.targetState);
  const stateNameKey = compact(stateName);
  const stateCodeKey = compact(stateCode);
  const candidates: SharedInboxCandidate[] = [];

  for (const rawEmail of emails) {
    const email = String(rawEmail ?? "").trim().toLowerCase();
    const at = email.lastIndexOf("@");
    if (at <= 0) continue;
    const local = email.slice(0, at).split("+")[0] ?? "";
    const localKey = compact(local);
    if (BLOCKED_SHARED_LOCAL_PARTS.has(localKey)) continue;
    const localTokens = normalize(local).split(" ").filter(Boolean);
    let classification = sharedFunction(local);
    let locationMatch = false;

    if (cityKey && localKey.includes(cityKey)) {
      locationMatch = true;
      classification ??= { priority: "HIGH" as const, score: 88, function: "LOCATION" };
    } else if ((stateNameKey && localKey.includes(stateNameKey)) || (stateCodeKey && localTokens.includes(stateCodeKey))) {
      locationMatch = true;
      classification ??= { priority: "MEDIUM" as const, score: 72, function: "LOCATION" };
    }

    if (!classification) continue;
    const reasons = [`Recognized ${classification.function.toLowerCase().replace(/_/g, " ")} shared inbox.`];
    let score = classification.score;
    if (locationMatch) {
      score += 8;
      reasons.push("Shared inbox local-part matches the target location.");
    }
    candidates.push({
      email,
      priority: classification.priority,
      score: Math.min(100, score),
      function: classification.function,
      locationMatch,
      reasons
    });
  }

  return candidates
    .sort((a, b) => b.score - a.score || a.email.localeCompare(b.email))
    .filter((item, index, array) => array.findIndex((candidate) => candidate.email === item.email) === index);
}
