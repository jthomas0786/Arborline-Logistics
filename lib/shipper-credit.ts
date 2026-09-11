import type { PoolClient } from "pg";
import { getPool } from "./db";

export type CreditSnapshot = {
  shipperId: string;
  legalName: string;
  organizationStatus: string;
  onboardingStatus: string;
  creditStatus: string;
  creditLimit: number | null;
  effectiveLimit: number | null;
  paymentTermsDays: number;
  riskScore: number;
  openAr: number;
  uninvoicedExposure: number;
  exposure: number;
  overrideId: string | null;
  overrideMaxExposure: number | null;
  overrideExpiresAt: string | null;
};

type Queryable = Pick<PoolClient, "query">;

function amount(value: unknown) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function getShipperCreditSnapshot(shipperId: string, client: Queryable = getPool()) : Promise<CreditSnapshot | null> {
  const { rows } = await client.query(
    `SELECT s.id shipper_id,o.legal_name,o.status organization_status,s.onboarding_status,s.credit_status,
            s.credit_limit,s.payment_terms_days,s.risk_score,
            COALESCE(ar.open_ar,0) open_ar,
            COALESCE(freight.uninvoiced_exposure,0) uninvoiced_exposure,
            ov.id override_id,ov.max_exposure override_max_exposure,ov.expires_at override_expires_at
     FROM shippers s
     JOIN organizations o ON o.id=s.organization_id
     LEFT JOIN LATERAL (
       SELECT COALESCE(sum(i.amount),0) open_ar
       FROM shipper_invoices i
       WHERE i.shipper_id=s.id AND i.status='ISSUED'
     ) ar ON true
     LEFT JOIN LATERAL (
       SELECT COALESCE(sum(l.shipper_rate),0) uninvoiced_exposure
       FROM loads l
       WHERE l.shipper_id=s.id
         AND l.status IN ('SEARCHING','OFFERING','BOOKED','DISPATCHED','AT_PICKUP','LOADED','IN_TRANSIT','AT_DELIVERY','DELIVERED','POD_RECEIVED')
     ) freight ON true
     LEFT JOIN LATERAL (
       SELECT id,max_exposure,expires_at
       FROM shipper_credit_overrides
       WHERE shipper_id=s.id AND revoked_at IS NULL AND expires_at>now()
       ORDER BY max_exposure DESC,created_at DESC
       LIMIT 1
     ) ov ON true
     WHERE s.id=$1`,
    [shipperId]
  );
  const row = rows[0];
  if (!row) return null;
  const baseLimit = amount(row.credit_limit);
  const overrideLimit = amount(row.override_max_exposure);
  const openAr = Number(row.open_ar ?? 0);
  const uninvoicedExposure = Number(row.uninvoiced_exposure ?? 0);
  return {
    shipperId: row.shipper_id,
    legalName: row.legal_name,
    organizationStatus: row.organization_status,
    onboardingStatus: row.onboarding_status,
    creditStatus: row.credit_status,
    creditLimit: baseLimit,
    effectiveLimit: overrideLimit === null ? baseLimit : Math.max(baseLimit ?? 0, overrideLimit),
    paymentTermsDays: Number(row.payment_terms_days ?? 30),
    riskScore: Number(row.risk_score ?? 0),
    openAr,
    uninvoicedExposure,
    exposure: openAr + uninvoicedExposure,
    overrideId: row.override_id ?? null,
    overrideMaxExposure: overrideLimit,
    overrideExpiresAt: row.override_expires_at ? new Date(row.override_expires_at).toISOString() : null
  };
}

export function canCreateQuote(snapshot: CreditSnapshot) {
  if (snapshot.organizationStatus !== "ACTIVE") return { allowed: false, reason: "Shipper account is not active." };
  if (snapshot.onboardingStatus !== "COMPLETE") return { allowed: false, reason: "Shipper onboarding is incomplete." };
  if (!['APPROVED','PREPAY'].includes(snapshot.creditStatus)) return { allowed: false, reason: `Credit status is ${snapshot.creditStatus}.` };
  return { allowed: true, reason: null };
}

export function canAcceptQuote(snapshot: CreditSnapshot, requestedAmount: number) {
  const projectedExposure = snapshot.exposure + requestedAmount;
  if (snapshot.organizationStatus !== "ACTIVE") return { allowed: false, reason: "Shipper account is not active.", projectedExposure };
  if (snapshot.onboardingStatus !== "COMPLETE") return { allowed: false, reason: "Shipper onboarding is incomplete.", projectedExposure };
  if (snapshot.creditStatus === "PREPAY") return { allowed: false, reason: "Prepayment is required before this shipment can be booked.", projectedExposure };
  if (snapshot.creditStatus !== "APPROVED") return { allowed: false, reason: `Credit status is ${snapshot.creditStatus}.`, projectedExposure };
  if (snapshot.effectiveLimit === null) return { allowed: false, reason: "No credit limit is configured.", projectedExposure };
  if (projectedExposure > snapshot.effectiveLimit) {
    return { allowed: false, reason: `Projected exposure exceeds the approved credit limit by $${(projectedExposure-snapshot.effectiveLimit).toFixed(2)}.`, projectedExposure };
  }
  return { allowed: true, reason: null, projectedExposure };
}

export async function recordCreditEvent(client: Queryable, input: {
  shipperId: string;
  quoteId?: string | null;
  eventType: string;
  previousStatus?: string | null;
  newStatus?: string | null;
  creditLimit?: number | null;
  exposureBefore?: number | null;
  requestedAmount?: number | null;
  projectedExposure?: number | null;
  decision?: string | null;
  reason?: string | null;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await client.query(
    `INSERT INTO shipper_credit_events
      (shipper_id,quote_id,event_type,previous_status,new_status,credit_limit,exposure_before,requested_amount,projected_exposure,decision,reason,actor_user_id,metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
    [input.shipperId,input.quoteId ?? null,input.eventType,input.previousStatus ?? null,input.newStatus ?? null,input.creditLimit ?? null,input.exposureBefore ?? null,input.requestedAmount ?? null,input.projectedExposure ?? null,input.decision ?? null,input.reason ?? null,input.actorUserId ?? null,JSON.stringify(input.metadata ?? {})]
  );
}
