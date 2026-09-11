import type { EquipmentType } from "./types";

export interface QuoteInput {
  equipmentType: EquipmentType;
  estimatedMiles: number;
  pickupAt: string;
  weightLbs?: number;
  targetMarginPct?: number;
  minimumMarginPct?: number;
}

export interface QuotePrice {
  expectedCarrierCost: number;
  targetCarrierRate: number;
  maxCarrierRate: number;
  shipperPrice: number;
  targetMarginPct: number;
  minimumMarginPct: number;
  pricingNotes: string[];
}

const roundMoney = (value: number) => Math.round(value * 100) / 100;
const envNumber = (name: string, fallback: number) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function ratePerMile(equipmentType: EquipmentType): number {
  if (equipmentType === "REEFER") return envNumber("PRICING_REEFER_RPM", 2.85);
  if (equipmentType === "FLATBED") return envNumber("PRICING_FLATBED_RPM", 2.75);
  return envNumber("PRICING_DRY_VAN_RPM", 2.35);
}

export function priceQuote(input: QuoteInput): QuotePrice {
  if (!Number.isFinite(input.estimatedMiles) || input.estimatedMiles <= 0) throw new Error("estimatedMiles must be greater than zero");

  const targetMarginPct = input.targetMarginPct ?? envNumber("AUTOMATION_TARGET_MARGIN_PCT", 15);
  const minimumMarginPct = input.minimumMarginPct ?? envNumber("AUTOMATION_MIN_MARGIN_PCT", 10);
  if (targetMarginPct <= 0 || targetMarginPct >= 50) throw new Error("targetMarginPct must be between 0 and 50");

  const notes: string[] = [];
  let carrierCost = Math.max(650, input.estimatedMiles * ratePerMile(input.equipmentType));

  const pickupTime = new Date(input.pickupAt).getTime();
  const hoursToPickup = (pickupTime - Date.now()) / 3_600_000;
  if (Number.isFinite(hoursToPickup) && hoursToPickup < 24) {
    carrierCost *= 1.12;
    notes.push("12% short-notice pickup adjustment");
  } else if (Number.isFinite(hoursToPickup) && hoursToPickup < 48) {
    carrierCost *= 1.06;
    notes.push("6% short-notice pickup adjustment");
  }

  if ((input.weightLbs ?? 0) > 42_000) {
    carrierCost *= 1.05;
    notes.push("5% heavy-load adjustment");
  }

  carrierCost = roundMoney(carrierCost);
  const shipperPrice = roundMoney(carrierCost / (1 - targetMarginPct / 100));
  const maxCarrierRate = roundMoney(shipperPrice * (1 - minimumMarginPct / 100));

  return {
    expectedCarrierCost: carrierCost,
    targetCarrierRate: carrierCost,
    maxCarrierRate,
    shipperPrice,
    targetMarginPct,
    minimumMarginPct,
    pricingNotes: notes
  };
}
