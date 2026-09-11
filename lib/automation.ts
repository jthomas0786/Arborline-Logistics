export interface AutomationInput {
  shipperRate: number;
  carrierRate: number;
  carrierFraudScore: number;
  authorityActive: boolean;
  insuranceValid: boolean;
  bankingChangedWithin48Hours: boolean;
  cargoValue: number;
  highValueThreshold?: number;
  minimumMarginPct?: number;
}

export type AutomationDecision =
  | { action: "AUTO_BOOK"; reason: string; grossMarginPct: number }
  | { action: "MANUAL_REVIEW"; reason: string; grossMarginPct: number }
  | { action: "BLOCK"; reason: string; grossMarginPct: number };

export function decideBooking(input: AutomationInput): AutomationDecision {
  const minimumMarginPct = input.minimumMarginPct ?? 10;
  const highValueThreshold = input.highValueThreshold ?? 75000;
  const grossMarginPct = input.shipperRate > 0
    ? ((input.shipperRate - input.carrierRate) / input.shipperRate) * 100
    : 0;

  if (!input.authorityActive) return { action: "BLOCK", reason: "Carrier authority is not active", grossMarginPct };
  if (!input.insuranceValid) return { action: "BLOCK", reason: "Carrier insurance is not valid", grossMarginPct };
  if (input.carrierFraudScore >= 70) return { action: "BLOCK", reason: "Carrier fraud score exceeds hard limit", grossMarginPct };
  if (input.bankingChangedWithin48Hours) return { action: "MANUAL_REVIEW", reason: "Recent payment destination change", grossMarginPct };
  if (input.cargoValue >= highValueThreshold) return { action: "MANUAL_REVIEW", reason: "High-value cargo", grossMarginPct };
  if (grossMarginPct < minimumMarginPct) return { action: "MANUAL_REVIEW", reason: "Margin is below automation floor", grossMarginPct };

  return { action: "AUTO_BOOK", reason: "All booking gates passed", grossMarginPct };
}
