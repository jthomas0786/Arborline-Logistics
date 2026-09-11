import { getPool } from "./db";

const normalizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const clampScore = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : null;
};
const ttlHours = () => {
  const value = Number(process.env.CARRIER_VERIFICATION_TTL_HOURS ?? 24);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 168) : 24;
};

export async function processCarrierVerificationQueue(limit = 10) {
  const pool = getPool();
  const providerUrl = process.env.CARRIER_VERIFICATION_WEBHOOK_URL;
  if (!providerUrl) {
    const { rows } = await pool.query(`SELECT count(*)::int count FROM carrier_verification_checks WHERE status IN ('PENDING','WAITING_PROVIDER')`);
    return { processed: 0, passed: 0, review: 0, waiting: Number(rows[0]?.count ?? 0), reason: "CARRIER_VERIFICATION_WEBHOOK_URL_NOT_CONFIGURED" };
  }

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
     SET status='PROCESSING',attempts=v.attempts+1,last_error=NULL
     FROM picked
     WHERE v.id=picked.id
     RETURNING v.*`,
    [Math.max(1, Math.min(50, limit))]
  );

  let passed = 0;
  let review = 0;
  let retrying = 0;

  for (const check of claim.rows) {
    const carrierResult = await pool.query(
      `SELECT c.id,c.usdot_number,c.mc_number,o.legal_name
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

    try {
      const response = await fetch(providerUrl, {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: {
          "content-type": "application/json",
          ...(process.env.CARRIER_VERIFICATION_WEBHOOK_TOKEN ? { authorization: `Bearer ${process.env.CARRIER_VERIFICATION_WEBHOOK_TOKEN}` } : {})
        },
        body: JSON.stringify({ requestId: check.id, usdotNumber: carrier.usdot_number, mcNumber: carrier.mc_number, legalName: carrier.legal_name })
      });
      if (!response.ok) throw new Error(`Verification provider returned ${response.status}`);
      const body = await response.json() as Record<string, unknown>;
      const authorityStatus = String(body.authorityStatus ?? "UNKNOWN").toUpperCase();
      const insuranceStatus = String(body.insuranceStatus ?? "UNKNOWN").toUpperCase();
      const verifiedLegalName = String(body.legalName ?? "").trim();
      const legalNameMatch = Boolean(verifiedLegalName) && normalizeName(verifiedLegalName) === normalizeName(carrier.legal_name);
      const providerVerified = body.verified === true;
      const isVerified = providerVerified && authorityStatus === "ACTIVE" && insuranceStatus === "VALID" && legalNameMatch;
      const fraudScore = clampScore(body.fraudScore);
      const sanitizedResult = { providerVerified, authorityStatus, insuranceStatus, legalNameMatch, ...(fraudScore === null ? {} : { fraudScore }) };

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE carrier_verification_checks
           SET status=$2,authority_status=$3,insurance_status=$4,verified_legal_name=$5,
               legal_name_match=$6,result=$7::jsonb,completed_at=now(),last_error=NULL
           WHERE id=$1`,
          [check.id, isVerified ? "PASSED" : "REVIEW", authorityStatus, insuranceStatus, verifiedLegalName || null, legalNameMatch, JSON.stringify(sanitizedResult)]
        );
        await client.query(
          `UPDATE carriers
           SET onboarding_status=$2,authority_status=$3,insurance_status=$4,
               verified_legal_name=$5,legal_name_verified=$6,last_verified_at=now(),
               verified_at=CASE WHEN $2='VERIFIED' THEN COALESCE(verified_at,now()) ELSE verified_at END,
               verification_expires_at=CASE WHEN $2='VERIFIED' THEN now()+($7 * interval '1 hour') ELSE NULL END,
               fraud_score=COALESCE($8,fraud_score)
           WHERE id=$1`,
          [carrier.id, isVerified ? "VERIFIED" : "REVIEW", authorityStatus, insuranceStatus, verifiedLegalName || null, legalNameMatch, ttlHours(), fraudScore]
        );
        if (!isVerified) {
          await client.query(
            `INSERT INTO exceptions (severity,category,description,recommended_action)
             VALUES ('HIGH','CARRIER_VERIFICATION',$1,'Review the carrier identity, authority, and insurance before allowing freight offers.')`,
            [`Carrier ${carrier.usdot_number} did not pass automated verification.`]
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }

      if (isVerified) passed += 1; else review += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown verification provider error";
      if (Number(check.attempts) >= 3) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(`UPDATE carrier_verification_checks SET status='REVIEW',last_error=$2,completed_at=now() WHERE id=$1`, [check.id, message]);
          await client.query(`UPDATE carriers SET onboarding_status='REVIEW',verification_expires_at=NULL WHERE id=$1`, [check.carrier_id]);
          await client.query(
            `INSERT INTO exceptions (severity,category,description,recommended_action)
             VALUES ('HIGH','CARRIER_VERIFICATION',$1,'Check the verification provider and review this carrier manually before activation.')`,
            [`Carrier verification failed after ${check.attempts} attempts: ${message}`]
          );
          await client.query("COMMIT");
        } catch (inner) {
          await client.query("ROLLBACK");
          throw inner;
        } finally { client.release(); }
        review += 1;
      } else {
        const backoffMinutes = Math.min(60, 5 * (2 ** Math.max(0, Number(check.attempts) - 1)));
        await pool.query(
          `UPDATE carrier_verification_checks
           SET status='PENDING',last_error=$2,next_attempt_at=now()+($3 * interval '1 minute')
           WHERE id=$1`,
          [check.id, message, backoffMinutes]
        );
        retrying += 1;
      }
    }
  }

  return { processed: claim.rowCount ?? 0, passed, review, retrying };
}
