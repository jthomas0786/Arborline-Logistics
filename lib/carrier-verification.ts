import type { PoolClient } from "pg";
import { getPool } from "./db";
import { fetchFmcsaSnapshot, FmcsaNotConfiguredError } from "./fmcsa";

const normalizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const clampScore = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : null;
};
const ttlHours = () => {
  const value = Number(process.env.CARRIER_VERIFICATION_TTL_HOURS ?? 24);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 168) : 24;
};

const complianceCategories = ["CARRIER_AUTHORITY", "CARRIER_IDENTITY", "CARRIER_INSURANCE", "CARRIER_FRAUD", "CARRIER_COMPLIANCE_PROVIDER"];

type InsuranceResult = {
  configured: boolean;
  verified: boolean;
  status: string;
  provider: string;
  expiresAt: string | null;
  fraudScore: number | null;
};

async function verifyInsurance(input: { requestId: string; carrierId: string; usdotNumber: string; mcNumber: string; legalName: string }): Promise<InsuranceResult> {
  const url = process.env.CARRIER_INSURANCE_VERIFICATION_URL?.trim() || process.env.CARRIER_VERIFICATION_WEBHOOK_URL?.trim();
  if (!url) return { configured: false, verified: false, status: "PENDING", provider: "NOT_CONFIGURED", expiresAt: null, fraudScore: null };

  const response = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: {
      "content-type": "application/json",
      ...(process.env.CARRIER_VERIFICATION_WEBHOOK_TOKEN ? { authorization: `Bearer ${process.env.CARRIER_VERIFICATION_WEBHOOK_TOKEN}` } : {})
    },
    body: JSON.stringify({ ...input, purpose: "INSURANCE" })
  });
  if (!response.ok) throw new Error(`INSURANCE_PROVIDER_${response.status}`);
  const body = await response.json() as Record<string, unknown>;
  const status = String(body.insuranceStatus ?? body.status ?? "UNKNOWN").trim().toUpperCase();
  const providerVerified = body.verified === true || body.insuranceVerified === true;
  const expiresRaw = body.insuranceExpiresAt ?? body.coverageExpiresAt ?? body.expiresAt;
  const expiresAt = typeof expiresRaw === "string" && !Number.isNaN(new Date(expiresRaw).getTime()) ? new Date(expiresRaw).toISOString() : null;
  const notExpired = !expiresAt || new Date(expiresAt).getTime() > Date.now();
  const verified = providerVerified && ["VALID", "ACTIVE", "COMPLIANT"].includes(status) && notExpired;
  return {
    configured: true,
    verified,
    status: verified ? "VALID" : status,
    provider: String(body.provider ?? "INSURANCE_WEBHOOK").slice(0, 80),
    expiresAt,
    fraudScore: clampScore(body.fraudScore)
  };
}

async function complianceEvent(client: PoolClient, carrierId: string, checkId: string | null, eventType: string, source: string, details: Record<string, unknown> = {}) {
  await client.query(
    `INSERT INTO carrier_compliance_events (carrier_id,verification_check_id,event_type,source,details)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [carrierId, checkId, eventType, source, JSON.stringify(details)]
  );
}

async function carrierException(client: PoolClient, carrierId: string, category: string, description: string, recommendedAction: string) {
  await client.query(
    `INSERT INTO exceptions (carrier_id,severity,category,description,recommended_action)
     SELECT $1,'HIGH',$2,$3,$4
     WHERE NOT EXISTS (
       SELECT 1 FROM exceptions WHERE carrier_id=$1 AND category=$2 AND status='OPEN'
     )`,
    [carrierId, category, description, recommendedAction]
  );
}

async function resolveCarrierExceptions(client: PoolClient, carrierId: string) {
  await client.query(
    `UPDATE exceptions SET status='RESOLVED',resolved_at=now()
     WHERE carrier_id=$1 AND status='OPEN' AND category=ANY($2::text[])`,
    [carrierId, complianceCategories]
  );
}

export async function queueDueCarrierReverifications() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO carrier_verification_checks (carrier_id,provider,status)
       SELECT c.id,'FMCSA_QCMOBILE','PENDING'
       FROM carriers c
       WHERE c.is_test_carrier=false
         AND c.onboarding_status='VERIFIED'
         AND (
           c.verification_expires_at IS NULL
           OR c.verification_expires_at<=now()+interval '2 hours'
           OR (c.insurance_expires_at IS NOT NULL AND c.insurance_expires_at<=now()+interval '24 hours')
         )
         AND NOT EXISTS (
           SELECT 1 FROM carrier_verification_checks v
           WHERE v.carrier_id=c.id AND v.status IN ('PENDING','PROCESSING','WAITING_PROVIDER')
         )
       RETURNING carrier_id,id`
    );
    for (const row of rows) {
      await complianceEvent(client, row.carrier_id, row.id, "REVERIFICATION_DUE", "SYSTEM", {});
    }
    await client.query("COMMIT");
    return { queued: rows.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function queueCarrierVerification(carrierId: string, source = "SYSTEM") {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT id FROM carrier_verification_checks
       WHERE carrier_id=$1 AND status IN ('PENDING','PROCESSING','WAITING_PROVIDER')
       ORDER BY created_at DESC LIMIT 1`,
      [carrierId]
    );
    if (existing.rows[0]) {
      await client.query("COMMIT");
      return { queued: false, checkId: existing.rows[0].id };
    }
    const { rows } = await client.query(
      `INSERT INTO carrier_verification_checks (carrier_id,provider,status)
       VALUES ($1,'FMCSA_QCMOBILE','PENDING') RETURNING id`,
      [carrierId]
    );
    await complianceEvent(client, carrierId, rows[0].id, "VERIFICATION_QUEUED", source, {});
    await client.query("COMMIT");
    return { queued: true, checkId: rows[0].id };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function processCarrierVerificationQueue(limit = 10) {
  const pool = getPool();
  const claim = await pool.query(
    `WITH picked AS (
       SELECT v.id
       FROM carrier_verification_checks v
       WHERE v.status IN ('PENDING','WAITING_PROVIDER') AND v.next_attempt_at<=now()
       ORDER BY v.created_at
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE carrier_verification_checks v
     SET status='PROCESSING',attempts=v.attempts+1,last_error=NULL,provider='FMCSA_QCMOBILE'
     FROM picked
     WHERE v.id=picked.id
     RETURNING v.*`,
    [Math.max(1, Math.min(50, limit))]
  );

  let passed = 0;
  let review = 0;
  let retrying = 0;
  let waiting = 0;

  for (const check of claim.rows) {
    const carrierResult = await pool.query(
      `SELECT c.id,c.usdot_number,c.mc_number,c.onboarding_status,c.verification_expires_at,c.fraud_score,
              c.is_test_carrier,o.legal_name
       FROM carriers c JOIN organizations o ON o.id=c.organization_id
       WHERE c.id=$1`,
      [check.carrier_id]
    );
    const carrier = carrierResult.rows[0];
    if (!carrier) {
      await pool.query(`UPDATE carrier_verification_checks SET status='FAILED',last_error='Carrier not found',completed_at=now() WHERE id=$1`, [check.id]);
      review += 1;
      continue;
    }

    if (carrier.is_test_carrier) {
      await pool.query(`UPDATE carrier_verification_checks SET provider='TEST_OVERRIDE',status='PASSED',completed_at=now(),last_error=NULL,result='{"testOnly":true}'::jsonb WHERE id=$1`, [check.id]);
      passed += 1;
      continue;
    }

    try {
      const fmcsa = await fetchFmcsaSnapshot(carrier.usdot_number);
      const legalNameMatch = normalizeName(fmcsa.legalName) === normalizeName(carrier.legal_name);
      const mcMatch = Boolean(fmcsa.mcNumber) && digits(fmcsa.mcNumber) === digits(carrier.mc_number);
      const authorityPassed = fmcsa.authorityActive && !fmcsa.outOfService;

      const insurance = await verifyInsurance({
        requestId: check.id,
        carrierId: carrier.id,
        usdotNumber: carrier.usdot_number,
        mcNumber: carrier.mc_number,
        legalName: carrier.legal_name
      });

      const fraudScore = insurance.fraudScore ?? clampScore(carrier.fraud_score) ?? 0;
      const fraudPassed = fraudScore < 70;
      const identityPassed = legalNameMatch && mcMatch;
      const fullyVerified = authorityPassed && identityPassed && insurance.verified && fraudPassed;

      const sanitizedResult = {
        fmcsa: fmcsa.summary,
        legalNameMatch,
        mcMatch,
        insurance: { configured: insurance.configured, verified: insurance.verified, status: insurance.status, provider: insurance.provider, expiresAt: insurance.expiresAt },
        fraudScore,
        fullyVerified
      };

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (!insurance.configured) {
          await client.query(
            `UPDATE carrier_verification_checks
             SET status='WAITING_PROVIDER',provider='FMCSA_QCMOBILE',authority_status=$2,insurance_status='PENDING',
                 verified_legal_name=$3,legal_name_match=$4,result=$5::jsonb,last_error='CARRIER_INSURANCE_VERIFICATION_URL_NOT_CONFIGURED',
                 next_attempt_at=now()+interval '1 hour'
             WHERE id=$1`,
            [check.id, authorityPassed ? "ACTIVE" : "INACTIVE", fmcsa.legalName, legalNameMatch, JSON.stringify(sanitizedResult)]
          );
          await client.query(
            `UPDATE carriers SET authority_status=$2,insurance_status='PENDING',verified_legal_name=$3,legal_name_verified=$4,
                    onboarding_status='VERIFICATION_PENDING',verification_source='FMCSA_QCMOBILE',fmcsa_allow_to_operate=$5,
                    fmcsa_out_of_service=$6,fmcsa_out_of_service_date=$7,fmcsa_snapshot_at=$8,last_verified_at=now(),
                    compliance_hold_reason='Insurance verification provider is not configured.'
             WHERE id=$1`,
            [carrier.id, authorityPassed ? "ACTIVE" : "INACTIVE", fmcsa.legalName, legalNameMatch, fmcsa.allowToOperate, fmcsa.outOfService, fmcsa.outOfServiceDate || null, fmcsa.fetchedAt]
          );
          await carrierException(client, carrier.id, "CARRIER_COMPLIANCE_PROVIDER", `Carrier ${carrier.usdot_number} passed the FMCSA lookup but insurance could not be verified because no insurance provider is configured.`, "Configure the carrier insurance verification provider before allowing production freight.");
          await complianceEvent(client, carrier.id, check.id, authorityPassed && identityPassed ? "FMCSA_PASSED" : "FMCSA_FAILED", "FMCSA_QCMOBILE", { authorityPassed, legalNameMatch, mcMatch });
          await client.query("COMMIT");
          waiting += 1;
          continue;
        }

        await client.query(
          `UPDATE carrier_verification_checks
           SET status=$2,provider='FMCSA_QCMOBILE+INSURANCE',authority_status=$3,insurance_status=$4,
               verified_legal_name=$5,legal_name_match=$6,result=$7::jsonb,completed_at=now(),last_error=NULL
           WHERE id=$1`,
          [check.id, fullyVerified ? "PASSED" : "REVIEW", authorityPassed ? "ACTIVE" : "INACTIVE", insurance.verified ? "VALID" : insurance.status, fmcsa.legalName, legalNameMatch, JSON.stringify(sanitizedResult)]
        );

        const reasons: string[] = [];
        if (!authorityPassed) reasons.push(fmcsa.outOfService ? "FMCSA out-of-service order" : "FMCSA does not allow carrier to operate");
        if (!legalNameMatch) reasons.push("legal name does not match FMCSA");
        if (!mcMatch) reasons.push("MC/docket number does not match FMCSA");
        if (!insurance.verified) reasons.push("insurance is not verified and active");
        if (!fraudPassed) reasons.push("fraud risk exceeds threshold");
        const holdReason = reasons.length ? reasons.join("; ") : null;
        const expirySql = insurance.expiresAt
          ? `LEAST(now()+($9 * interval '1 hour'),$10::timestamptz)`
          : `now()+($9 * interval '1 hour')`;

        await client.query(
          `UPDATE carriers
           SET onboarding_status=$2,authority_status=$3,insurance_status=$4,verified_legal_name=$5,legal_name_verified=$6,
               verification_source='FMCSA_QCMOBILE+INSURANCE',fmcsa_allow_to_operate=$7,fmcsa_out_of_service=$8,
               fmcsa_out_of_service_date=$11,fmcsa_snapshot_at=$12,insurance_verified_at=CASE WHEN $13 THEN now() ELSE insurance_verified_at END,
               insurance_expires_at=$10,last_verified_at=now(),verified_at=CASE WHEN $2='VERIFIED' THEN COALESCE(verified_at,now()) ELSE verified_at END,
               verification_expires_at=CASE WHEN $2='VERIFIED' THEN ${expirySql} ELSE NULL END,
               fraud_score=$14,compliance_hold_reason=$15
           WHERE id=$1`,
          [carrier.id, fullyVerified ? "VERIFIED" : "REVIEW", authorityPassed ? "ACTIVE" : "INACTIVE", insurance.verified ? "VALID" : insurance.status,
            fmcsa.legalName, legalNameMatch, fmcsa.allowToOperate, fmcsa.outOfService, ttlHours(), insurance.expiresAt,
            fmcsa.outOfServiceDate || null, fmcsa.fetchedAt, insurance.verified, fraudScore, holdReason]
        );

        await complianceEvent(client, carrier.id, check.id, authorityPassed && identityPassed ? "FMCSA_PASSED" : "FMCSA_FAILED", "FMCSA_QCMOBILE", { authorityPassed, legalNameMatch, mcMatch, outOfService: fmcsa.outOfService });
        await complianceEvent(client, carrier.id, check.id, insurance.verified ? "INSURANCE_PASSED" : "INSURANCE_FAILED", insurance.provider, { status: insurance.status, expiresAt: insurance.expiresAt });

        if (fullyVerified) {
          await resolveCarrierExceptions(client, carrier.id);
          await complianceEvent(client, carrier.id, check.id, "CARRIER_VERIFIED", "SYSTEM", { verificationExpiresInHours: ttlHours() });
        } else {
          let category = "CARRIER_IDENTITY";
          if (!authorityPassed) category = "CARRIER_AUTHORITY";
          else if (!insurance.verified) category = "CARRIER_INSURANCE";
          else if (!fraudPassed) category = "CARRIER_FRAUD";
          await carrierException(client, carrier.id, category, `Carrier ${carrier.usdot_number} is on compliance hold: ${holdReason}.`, "Resolve the failed compliance gate and rerun verification before allowing freight offers.");
          await complianceEvent(client, carrier.id, check.id, "CARRIER_HELD", "SYSTEM", { reasons });
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }

      if (fullyVerified) passed += 1; else review += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown carrier verification error";
      if (error instanceof FmcsaNotConfiguredError) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(`UPDATE carrier_verification_checks SET status='WAITING_PROVIDER',provider='FMCSA_QCMOBILE',last_error=$2,next_attempt_at=now()+interval '1 hour' WHERE id=$1`, [check.id, message]);
          await client.query(`UPDATE carriers SET onboarding_status='VERIFICATION_PENDING',compliance_hold_reason='FMCSA WebKey is not configured.' WHERE id=$1 AND onboarding_status<>'VERIFIED'`, [carrier.id]);
          await carrierException(client, carrier.id, "CARRIER_COMPLIANCE_PROVIDER", `Carrier ${carrier.usdot_number} cannot be verified because the FMCSA QCMobile WebKey is not configured.`, "Configure FMCSA_WEB_KEY and rerun carrier verification.");
          await client.query("COMMIT");
        } catch (inner) {
          await client.query("ROLLBACK");
          throw inner;
        } finally { client.release(); }
        waiting += 1;
        continue;
      }

      if (Number(check.attempts) >= 3) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(`UPDATE carrier_verification_checks SET status='REVIEW',last_error=$2,completed_at=now() WHERE id=$1`, [check.id, message]);
          await client.query(`UPDATE carriers SET onboarding_status='REVIEW',verification_expires_at=NULL,compliance_hold_reason=$2 WHERE id=$1`, [carrier.id, message.slice(0, 500)]);
          await carrierException(client, carrier.id, "CARRIER_COMPLIANCE_PROVIDER", `Carrier verification failed after ${check.attempts} attempts: ${message}`, "Review the provider response and rerun verification before allowing freight offers.");
          await complianceEvent(client, carrier.id, check.id, "CARRIER_HELD", "SYSTEM", { providerError: message });
          await client.query("COMMIT");
        } catch (inner) {
          await client.query("ROLLBACK");
          throw inner;
        } finally { client.release(); }
        review += 1;
      } else {
        const backoffMinutes = Math.min(60, 5 * (2 ** Math.max(0, Number(check.attempts) - 1)));
        await pool.query(
          `UPDATE carrier_verification_checks SET status='PENDING',last_error=$2,next_attempt_at=now()+($3 * interval '1 minute') WHERE id=$1`,
          [check.id, message, backoffMinutes]
        );
        retrying += 1;
      }
    }
  }

  return { processed: claim.rowCount ?? 0, passed, review, retrying, waiting };
}
