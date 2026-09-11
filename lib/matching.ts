import type { CarrierCandidate, LoadForMatching, RankedMatch } from "./types";

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));

export function evaluateCandidate(load: LoadForMatching, candidate: CarrierCandidate): RankedMatch {
  const rejectionReasons: string[] = [];

  if (!candidate.authorityActive) rejectionReasons.push("INACTIVE_AUTHORITY");
  if (!candidate.insuranceValid) rejectionReasons.push("INVALID_INSURANCE");
  if (candidate.fraudScore >= 70) rejectionReasons.push("FRAUD_RISK");
  if (candidate.equipmentType !== load.equipmentType) rejectionReasons.push("EQUIPMENT_MISMATCH");
  if (candidate.deadheadMiles > load.maxDeadheadMiles) rejectionReasons.push("DEADHEAD_LIMIT");
  if (candidate.proposedRate > load.maxCarrierRate) rejectionReasons.push("RATE_LIMIT");
  if (!candidate.pickupFeasible) rejectionReasons.push("PICKUP_NOT_FEASIBLE");

  const proximity = clamp(100 - (candidate.deadheadMiles / Math.max(load.maxDeadheadMiles, 1)) * 100);
  const rateFit = clamp(100 - Math.max(0, candidate.proposedRate - load.maxCarrierRate * 0.9) / Math.max(load.maxCarrierRate * 0.1, 1) * 100);
  const fraudSafety = clamp(100 - candidate.fraudScore);

  const matchScore =
    proximity * 0.25 +
    clamp(candidate.reliabilityScore) * 0.2 +
    rateFit * 0.15 +
    (candidate.pickupFeasible ? 100 : 0) * 0.1 +
    clamp(candidate.lanePreferenceScore) * 0.1 +
    clamp(candidate.trackingComplianceScore) * 0.08 +
    fraudSafety * 0.12;

  return {
    ...candidate,
    eligible: rejectionReasons.length === 0,
    rejectionReasons,
    matchScore: Math.round(matchScore * 100) / 100,
  };
}

export function rankCandidates(load: LoadForMatching, candidates: CarrierCandidate[]): RankedMatch[] {
  return candidates
    .map((candidate) => evaluateCandidate(load, candidate))
    .sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      return b.matchScore - a.matchScore;
    });
}
