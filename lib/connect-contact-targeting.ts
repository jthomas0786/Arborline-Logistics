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

function sourceContainsState(sourceText: string, state: string | null | undefined) {
  const stateValue = normalize(state);
  if (!stateValue || stateValue.length <= 2) return false;
  return ` ${normalize(sourceText)} `.includes(` ${stateValue} `);
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
  const multiLocation = Number(context.locationCount) > 1;

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
    score += multiLocation ? 14 : 8;
    locationMatch = "TARGET_CITY";
    reasons.push(`Public evidence ties the contact context to ${context.targetCity}.`);
  } else if (stateMatch) {
    score += multiLocation ? 7 : 4;
    locationMatch = "TARGET_STATE";
    reasons.push(`Public evidence ties the contact context to ${context.targetState}.`);
  } else if (singleLocation) {
    score += 4;
    locationMatch = "SINGLE_LOCATION";
    reasons.push("The prospect is recorded as a single-location company, reducing branch mismatch risk.");
  } else if (multiLocation) {
    reasons.push("The prospect has multiple locations and no target-location match was found for this contact.");
    if (roleFunction === "EXECUTIVE") score -= 4;
  }

  if ((companySize === "MID" || companySize === "LARGE") && roleFunction === "EXECUTIVE") {
    reasons.push("Corporate executive seniority is intentionally de-emphasized for larger companies when operating leaders are available.");
  }
  if (roleFunction === "BRANCH_REGIONAL" || roleFunction === "OPERATIONS") {
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
  const stateKey = compact(context.targetState);
  const candidates: SharedInboxCandidate[] = [];

  for (const rawEmail of emails) {
    const email = String(rawEmail ?? "").trim().toLowerCase();
    const at = email.lastIndexOf("@");
    if (at <= 0) continue;
    const local = email.slice(0, at).split("+")[0] ?? "";
    const localKey = compact(local);
    let classification = sharedFunction(local);
    let locationMatch = false;

    if (cityKey && localKey.includes(cityKey)) {
      locationMatch = true;
      classification ??= { priority: "HIGH" as const, score: 88, function: "LOCATION" };
    } else if (stateKey.length > 2 && localKey.includes(stateKey)) {
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
