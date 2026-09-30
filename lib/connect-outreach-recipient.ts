import { scoreContactTarget } from "./connect-contact-targeting";

type CandidateRecord = Record<string, unknown>;

type RankedCandidate = {
  candidateId: string | null;
  contactName: string | null;
  contactTitle: string | null;
  email: string;
  sourceKind: string;
  targetingScore: number;
  locationMatch: string;
  sourceStrength: number;
  identityConfidence: number;
  emailConfidence: number;
  verifiedAt: number;
};

function record(value: unknown): CandidateRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as CandidateRecord : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function locationRank(value: string) {
  if (value === "TARGET_CITY") return 3;
  if (value === "TARGET_STATE") return 2;
  if (value === "SINGLE_LOCATION") return 1;
  return 0;
}

function candidateSourceStrength(candidate: CandidateRecord) {
  const metadata = record(candidate.metadata);
  if (metadata.direct_published === true && metadata.identity_bound === true) return 4;
  const sourceKind = text(candidate.source_kind).toUpperCase();
  if (sourceKind === "PUBLIC_SITE" || sourceKind === "PUBLIC_PROFILE") return 3;
  if (candidate.primary_contact === true) return 2;
  return 1;
}

function rankCandidate(prospect: CandidateRecord, candidate: CandidateRecord): RankedCandidate | null {
  const email = text(candidate.email).toLowerCase();
  if (!email || !email.includes("@")) return null;

  const contactTitle = text(candidate.contact_title) || null;
  const contactName = text(candidate.contact_name) || null;
  const sourceUrl = text(candidate.source_url);
  const evidence = candidate.evidence ?? candidate.metadata ?? "";
  const sourceText = `${typeof evidence === "string" ? evidence : JSON.stringify(evidence)}\n${sourceUrl}`;
  const targeting = scoreContactTarget(contactTitle || "", sourceText, sourceUrl, {
    targetCity: text(prospect.city) || null,
    targetState: text(prospect.state) || null,
    employeeCount: number(prospect.employee_count, 0) || null,
    locationCount: number(prospect.location_count, 0) || null
  });

  const verifiedAtRaw = text(candidate.verified_at);
  const verifiedAt = verifiedAtRaw ? Date.parse(verifiedAtRaw) || 0 : 0;
  return {
    candidateId: text(candidate.id) || null,
    contactName,
    contactTitle,
    email,
    sourceKind: text(candidate.source_kind) || (candidate.primary_contact === true ? "PROSPECT_PRIMARY" : "UNKNOWN"),
    targetingScore: targeting.score,
    locationMatch: targeting.locationMatch,
    sourceStrength: candidateSourceStrength(candidate),
    identityConfidence: number(candidate.identity_confidence, candidate.primary_contact === true ? 90 : 0),
    emailConfidence: number(candidate.email_confidence, candidate.primary_contact === true ? 95 : 0),
    verifiedAt
  };
}

export function selectCanonicalOutreachRecipient<T extends CandidateRecord>(prospect: T) {
  const candidates: CandidateRecord[] = [];
  const rawPool = Array.isArray(prospect.verified_person_candidates) ? prospect.verified_person_candidates : [];
  for (const value of rawPool) candidates.push(record(value));

  if (prospect.top_level_contact_verified === true && text(prospect.contact_email)) {
    candidates.push({
      id: null,
      contact_name: prospect.contact_name,
      contact_title: prospect.contact_title,
      email: prospect.contact_email,
      source_url: prospect.source_url,
      evidence: prospect.source_metadata,
      source_kind: "PROSPECT_PRIMARY",
      primary_contact: true,
      identity_confidence: 90,
      email_confidence: 95,
      verified_at: prospect.updated_at
    });
  }

  const rankedByEmail = new Map<string, RankedCandidate>();
  for (const candidate of candidates) {
    const ranked = rankCandidate(prospect, candidate);
    if (!ranked) continue;
    const existing = rankedByEmail.get(ranked.email);
    if (!existing || compareRanked(ranked, existing) < 0) rankedByEmail.set(ranked.email, ranked);
  }

  const ranked = [...rankedByEmail.values()].sort(compareRanked);
  const best = ranked[0];
  if (best) {
    return {
      ...prospect,
      outreach_recipient_email: best.email,
      outreach_recipient_type: "PERSON",
      outreach_contact_name: best.contactName || text(prospect.contact_name) || null,
      outreach_contact_title: best.contactTitle || text(prospect.contact_title) || null,
      outreach_recipient_candidate_id: best.candidateId,
      outreach_recipient_targeting_score: best.targetingScore,
      outreach_recipient_location_match: best.locationMatch,
      outreach_recipient_selection_source: best.sourceKind
    };
  }

  const shared = text(prospect.shared_outreach_recipient_email).toLowerCase();
  if (shared) {
    return {
      ...prospect,
      outreach_recipient_email: shared,
      outreach_recipient_type: "SHARED_INBOX",
      outreach_contact_name: null,
      outreach_contact_title: null,
      outreach_recipient_candidate_id: null,
      outreach_recipient_targeting_score: null,
      outreach_recipient_location_match: "UNKNOWN",
      outreach_recipient_selection_source: "SHARED_INBOX"
    };
  }

  return {
    ...prospect,
    outreach_recipient_email: null,
    outreach_recipient_type: null,
    outreach_contact_name: null,
    outreach_contact_title: null,
    outreach_recipient_candidate_id: null,
    outreach_recipient_targeting_score: null,
    outreach_recipient_location_match: "UNKNOWN",
    outreach_recipient_selection_source: "NONE"
  };
}

function compareRanked(left: RankedCandidate, right: RankedCandidate) {
  if (left.targetingScore !== right.targetingScore) return right.targetingScore - left.targetingScore;
  const leftLocation = locationRank(left.locationMatch);
  const rightLocation = locationRank(right.locationMatch);
  if (leftLocation !== rightLocation) return rightLocation - leftLocation;
  if (left.sourceStrength !== right.sourceStrength) return right.sourceStrength - left.sourceStrength;
  if (left.identityConfidence !== right.identityConfidence) return right.identityConfidence - left.identityConfidence;
  if (left.emailConfidence !== right.emailConfidence) return right.emailConfidence - left.emailConfidence;
  if (left.verifiedAt !== right.verifiedAt) return right.verifiedAt - left.verifiedAt;
  return left.email.localeCompare(right.email);
}
