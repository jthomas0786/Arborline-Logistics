export type ConnectIcpProfile = {
  target_industries: string[];
  target_geographies: string[];
  min_employees: number | null;
  max_employees: number | null;
  min_locations: number | null;
  max_locations: number | null;
  facility_types: string[];
  decision_maker_titles: string[];
  buying_signals: string[];
  exclusions: string[];
  minimum_score: number;
};

export type ConnectProspectInput = {
  company_name: string;
  domain?: string | null;
  industry?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  employee_count?: number | null;
  location_count?: number | null;
  facility_type?: string | null;
  contact_title?: string | null;
  buying_signals?: string[] | null;
  suppression_status?: string | null;
};

export type QualificationReason = {
  key: string;
  label: string;
  matched: boolean;
  points: number;
  possible: number;
  detail: string;
};

export type QualificationResult = {
  score: number;
  status: "QUALIFIED" | "REVIEW" | "REJECTED" | "SUPPRESSED";
  reasons: QualificationReason[];
};

function norm(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function includesLoose(values: string[], candidate: string | null | undefined) {
  const target = norm(candidate);
  if (!target) return false;
  return values.some((value) => {
    const expected = norm(value);
    return expected && (target.includes(expected) || expected.includes(target));
  });
}

function normalizeTitle(value: string | null | undefined) {
  return norm(value).replace(/[,&/()\-]+/g, " ").replace(/\s+/g, " ").trim();
}

function matchesDecisionMakerTitle(values: string[], candidate: string | null | undefined) {
  const target = normalizeTitle(candidate);
  if (!target) return false;

  return values.some(value => {
    const expected = normalizeTitle(value);
    if (!expected) return false;

    if (expected === "president") {
      return /\bpresident\b/.test(target) && !/\bvice president\b/.test(target);
    }
    if (expected === "owner") return /\bowner\b/.test(target);
    if (expected === "founder") return /\bfounder\b/.test(target);
    if (expected === "ceo") return /\bceo\b/.test(target) || target.includes("chief executive officer");

    if (expected === "vp sales" || expected === "vice president of sales") {
      return /\b(vp|vice president)\b/.test(target) && /\bsales\b/.test(target);
    }
    if (expected === "sales director") {
      return /\bdirector\b/.test(target) && /\bsales\b/.test(target);
    }
    if (expected === "director of business development") {
      return /\bdirector\b/.test(target) && target.includes("business development");
    }

    return target === expected || target.includes(expected);
  });
}

function matchesAnyText(values: string[], candidates: Array<string | null | undefined>) {
  return candidates.some((candidate) => includesLoose(values, candidate));
}

export function scoreConnectProspect(prospect: ConnectProspectInput, icp: ConnectIcpProfile): QualificationResult {
  const reasons: QualificationReason[] = [];
  const haystack = [prospect.company_name, prospect.domain, prospect.industry, prospect.facility_type].map(norm).join(" ");
  const excluded = icp.exclusions.some((value) => haystack.includes(norm(value)));

  if (prospect.suppression_status && prospect.suppression_status !== "CLEAR") {
    return {
      score: 0,
      status: "SUPPRESSED",
      reasons: [{ key: "suppression", label: "Suppression check", matched: false, points: 0, possible: 100, detail: `Blocked by ${prospect.suppression_status.toLowerCase().replaceAll("_", " ")}.` }]
    };
  }

  if (excluded) {
    return {
      score: 0,
      status: "REJECTED",
      reasons: [{ key: "exclusion", label: "Exclusion check", matched: false, points: 0, possible: 100, detail: "Prospect matches an ICP exclusion." }]
    };
  }

  function add(key: string, label: string, possible: number, applicable: boolean, matched: boolean, detail: string) {
    if (!applicable) return;
    reasons.push({ key, label, matched, points: matched ? possible : 0, possible, detail });
  }

  const industryEvidence = [prospect.industry, prospect.company_name, prospect.domain, prospect.facility_type].filter(Boolean).join(" · ");
  const industryMatch = matchesAnyText(icp.target_industries, [prospect.industry, prospect.company_name, prospect.domain, prospect.facility_type]);
  add("industry", "Industry fit", 25, icp.target_industries.length > 0, industryMatch, industryEvidence ? `Industry evidence: ${industryEvidence}.` : "Industry evidence is missing.");

  const geography = [prospect.city, prospect.state, prospect.country].filter(Boolean).join(", ");
  add("geography", "Geography fit", 20, icp.target_geographies.length > 0, matchesAnyText(icp.target_geographies, [prospect.city, prospect.state, geography]), geography ? `Location: ${geography}.` : "Location is missing.");

  const employeeRangeConfigured = icp.min_employees !== null || icp.max_employees !== null;
  const employees = prospect.employee_count ?? null;
  const employeeMatch = employees !== null && (icp.min_employees === null || employees >= icp.min_employees) && (icp.max_employees === null || employees <= icp.max_employees);
  add("employees", "Company size", 15, employeeRangeConfigured, employeeMatch, employees === null ? "Employee count is missing." : `${employees} employees.`);

  const locationRangeConfigured = icp.min_locations !== null || icp.max_locations !== null;
  const locations = prospect.location_count ?? null;
  const locationMatch = locations !== null && (icp.min_locations === null || locations >= icp.min_locations) && (icp.max_locations === null || locations <= icp.max_locations);
  add("locations", "Location count", 10, locationRangeConfigured, locationMatch, locations === null ? "Location count is missing." : `${locations} location${locations === 1 ? "" : "s"}.`);

  add("facility", "Facility type", 10, icp.facility_types.length > 0, includesLoose(icp.facility_types, prospect.facility_type), prospect.facility_type ? `Facility: ${prospect.facility_type}.` : "Facility type is missing.");
  add("contact", "Decision maker", 10, icp.decision_maker_titles.length > 0, matchesDecisionMakerTitle(icp.decision_maker_titles, prospect.contact_title), prospect.contact_title ? `Contact title: ${prospect.contact_title}.` : "Decision-maker title is missing.");

  const signals = prospect.buying_signals ?? [];
  const signalMatch = signals.some((signal) => includesLoose(icp.buying_signals, signal));
  add("signals", "Buying signal", 10, icp.buying_signals.length > 0, signalMatch, signals.length ? `Signals: ${signals.join(", ")}.` : "No buying signal captured yet.");

  const possible = reasons.reduce((sum, reason) => sum + reason.possible, 0);
  const earned = reasons.reduce((sum, reason) => sum + reason.points, 0);
  const score = possible > 0 ? Math.round((earned / possible) * 100) : 0;
  const minimum = Math.max(0, Math.min(100, icp.minimum_score ?? 70));
  const hasMissingData = reasons.some((reason) => !reason.matched && /missing|No buying signal/i.test(reason.detail));

  return {
    score,
    status: score >= minimum ? "QUALIFIED" : hasMissingData && score >= Math.max(0, minimum - 20) ? "REVIEW" : "REJECTED",
    reasons
  };
}