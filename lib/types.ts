export type EquipmentType = "DRY_VAN" | "REEFER" | "FLATBED";

export interface LoadForMatching {
  id: string;
  equipmentType: EquipmentType;
  maxDeadheadMiles: number;
  maxCarrierRate: number;
  pickupAt: string;
}

export interface CarrierCandidate {
  carrierId: string;
  truckId: string;
  equipmentType: EquipmentType;
  deadheadMiles: number;
  proposedRate: number;
  reliabilityScore: number;
  lanePreferenceScore: number;
  trackingComplianceScore: number;
  fraudScore: number;
  authorityActive: boolean;
  insuranceValid: boolean;
  pickupFeasible: boolean;
}

export interface RankedMatch extends CarrierCandidate {
  matchScore: number;
  eligible: boolean;
  rejectionReasons: string[];
}
