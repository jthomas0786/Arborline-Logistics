import type { PoolClient } from "pg";
import { decideBooking } from "./automation";
import { getPool } from "./db";
import { rankCandidates } from "./matching";
import type { AutopilotResult, CarrierCandidate, EquipmentType, OfferResponse } from "./types";

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const searchRadii = () => (process.env.AUTOMATION_SEARCH_RADII ?? "25,50,75,100,150")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);

const offerFanout = () => Math.max(1, Math.min(10, toNumber(process.env.AUTOMATION_OFFER_FANOUT, 3)));
const offerTtlMinutes = () => Math.max(5, toNumber(process.env.AUTOMATION_OFFER_TTL_MINUTES, 15));

async function createException(client: PoolClient, loadId: string, category: string, description: string, recommendedAction: string, severity = "REVIEW") {
  await client.query(
    `INSERT INTO exceptions (load_id, severity, category, description, recommended_action)
     VALUES ($1,$2,$3,$4,$5)`,
    [loadId, severity, category, description, recommendedAction]
  );
}

async function pauseLoad(loadId: string, category: string, description: string, recommendedAction: string, reason: string): Promise<AutopilotResult> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE loads SET status='EXCEPTION' WHERE id=$1`, [loadId]);
    await createException(client, loadId, category, description, recommendedAction);
    await client.query(`INSERT INTO load_events (load_id,event_type,metadata) VALUES ($1,'AUTOPILOT_PAUSED',$2::jsonb)`, [loadId, JSON.stringify({ reason })]);
    await client.query("COMMIT");
    return { loadId, status: "EXCEPTION", reason };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function activeOfferCount(client: PoolClient, loadId: string) {
  const { rows } = await client.query(
    `SELECT count(*)::int count FROM offers
     WHERE load_id=$1 AND status IN ('PENDING','OPENED','COUNTERED')
       AND (expires_at IS NULL OR expires_at>now())`,
    [loadId]
  );
  return Number(rows[0]?.count ?? 0);
}

async function safeCapacityRecovery(loadId: string): Promise<AutopilotResult> {
  try {
    return await runAutopilot(loadId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown capacity recovery error";
    const pool = getPool();
    try {
      await pool.query(`UPDATE loads SET status='EXCEPTION' WHERE id=$1 AND status<>'BOOKED'`, [loadId]);
      await pool.query(
        `INSERT INTO exceptions (load_id,severity,category,description,recommended_action)
         VALUES ($1,'HIGH','AUTOMATION_RECOVERY',$2,'Review the load and rerun Autopilot after correcting the failure.')`,
        [loadId, reason]
      );
      await pool.query(
        `INSERT INTO load_events (load_id,event_type,metadata)
         VALUES ($1,'AUTOPILOT_RECOVERY_FAILED',$2::jsonb)`,
        [loadId, JSON.stringify({ reason })]
      );
    } catch {
      // The carrier response has already been committed. Never turn a successful
      // decline/expiration into a false client error because recovery logging failed.
    }
    return { loadId, status: "EXCEPTION", reason: "AUTOPILOT_RECOVERY_FAILED" };
  }
}

export async function runAutopilot(loadId: string): Promise<AutopilotResult> {
  const pool = getPool();
  const loadResult = await pool.query(
    `SELECT id, reference_number, status, equipment_type, pickup_start, target_carrier_rate, max_carrier_rate,
            origin_location IS NOT NULL AS has_origin_location
     FROM loads WHERE id=$1`,
    [loadId]
  );
  const load = loadResult.rows[0];
  if (!load) throw new Error("Load not found");
  if (load.status === "BOOKED") return { loadId, status: "BOOKED" };
  if (!load.has_origin_location) {
    return pauseLoad(loadId, "LOCATION", "Pickup coordinates are unavailable, so nearby capacity cannot be searched safely.", "Geocode the pickup location or enter pickup coordinates.", "ORIGIN_LOCATION_REQUIRED");
  }

  const targetCarrierRate = toNumber(load.target_carrier_rate, 0);
  const maxCarrierRate = toNumber(load.max_carrier_rate, 0);
  if (targetCarrierRate <= 0 || maxCarrierRate <= 0) {
    return pauseLoad(loadId, "PRICING", "The load does not have a valid target and maximum carrier rate.", "Price the load before starting carrier search.", "PRICING_REQUIRED");
  }

  let ranked: ReturnType<typeof rankCandidates> = [];
  let chosenRadius = searchRadii().at(-1) ?? 150;

  for (const radius of searchRadii()) {
    const result = await pool.query(
      `SELECT c.id AS carrier_id, t.id AS truck_id, t.equipment_type,
              ST_Distance(t.current_location, l.origin_location) / 1609.344 AS deadhead_miles,
              c.performance_score, c.fraud_score, c.authority_status, c.insurance_status,
              t.available_at
       FROM trucks t
       JOIN carriers c ON c.id=t.carrier_id
       JOIN loads l ON l.id=$1
       WHERE t.status='AVAILABLE'
         AND t.current_location IS NOT NULL
         AND t.equipment_type=l.equipment_type
         AND c.onboarding_status='VERIFIED'
         AND c.legal_name_verified=true
         AND c.verification_expires_at IS NOT NULL
         AND c.verification_expires_at>now()
         AND ST_DWithin(t.current_location, l.origin_location, $2 * 1609.344)
         AND NOT EXISTS (
           SELECT 1 FROM offers prior
           WHERE prior.load_id=l.id AND prior.carrier_id=c.id
             AND (
               prior.status IN ('DECLINED','EXPIRED')
               OR (prior.status IN ('PENDING','OPENED','COUNTERED') AND prior.expires_at IS NOT NULL AND prior.expires_at<=now())
             )
         )
       ORDER BY ST_Distance(t.current_location, l.origin_location)
       LIMIT 100`,
      [loadId, radius]
    );

    const candidates: CarrierCandidate[] = result.rows.map((row) => ({
      carrierId: row.carrier_id,
      truckId: row.truck_id,
      equipmentType: row.equipment_type as EquipmentType,
      deadheadMiles: toNumber(row.deadhead_miles),
      proposedRate: targetCarrierRate,
      reliabilityScore: toNumber(row.performance_score, 50),
      lanePreferenceScore: 70,
      trackingComplianceScore: 90,
      fraudScore: toNumber(row.fraud_score),
      authorityActive: row.authority_status === "ACTIVE",
      insuranceValid: row.insurance_status === "VALID",
      pickupFeasible: !row.available_at || new Date(row.available_at).getTime() <= new Date(load.pickup_start).getTime()
    }));

    ranked = rankCandidates({
      id: loadId,
      equipmentType: load.equipment_type as EquipmentType,
      maxDeadheadMiles: radius,
      maxCarrierRate,
      pickupAt: load.pickup_start
    }, candidates);
    chosenRadius = radius;
    if (ranked.filter((match) => match.eligible).length >= offerFanout()) break;
  }

  const eligible = ranked.filter((match) => match.eligible);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM load_matches WHERE load_id=$1`, [loadId]);
    for (const match of ranked.slice(0, 50)) {
      await client.query(
        `INSERT INTO load_matches (load_id,carrier_id,truck_id,deadhead_miles,proposed_rate,reliability_score,fraud_score,match_score,eligible,rejection_reasons)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
        [loadId, match.carrierId, match.truckId, match.deadheadMiles, match.proposedRate, match.reliabilityScore, match.fraudScore, match.matchScore, match.eligible, JSON.stringify(match.rejectionReasons)]
      );
    }

    await client.query(
      `INSERT INTO automation_decisions (load_id,decision_type,inputs,rules_used,decision)
       VALUES ($1,'CAPACITY_SEARCH',$2::jsonb,$3::jsonb,$4::jsonb)`,
      [loadId, JSON.stringify({ candidateCount: ranked.length }), JSON.stringify({ searchRadiusMiles: chosenRadius, offerFanout: offerFanout(), verificationRequired: true }), JSON.stringify({ eligibleCount: eligible.length })]
    );

    if (!eligible.length) {
      await client.query(`UPDATE loads SET status='EXCEPTION' WHERE id=$1`, [loadId]);
      await createException(client, loadId, "CAPACITY", `No currently verified eligible carrier was found within ${chosenRadius} miles.`, "Review market rate, carrier verification coverage, or use an external capacity provider.");
      await client.query(`INSERT INTO load_events (load_id,event_type,metadata) VALUES ($1,'NO_CAPACITY',$2::jsonb)`, [loadId, JSON.stringify({ searchRadiusMiles: chosenRadius })]);
      await client.query("COMMIT");
      return { loadId, status: "EXCEPTION", searchRadiusMiles: chosenRadius, eligibleMatches: 0, offersCreated: 0, reason: "NO_ELIGIBLE_CAPACITY" };
    }

    await client.query(`UPDATE offers SET status='CANCELLED' WHERE load_id=$1 AND status IN ('PENDING','OPENED','COUNTERED')`, [loadId]);
    await client.query(`UPDATE outbox_messages SET status='CANCELLED' WHERE load_id=$1 AND status IN ('PENDING','WAITING_PROVIDER','WAITING_CONTACT','WAITING_SUBSCRIBER')`, [loadId]);
    let offersCreated = 0;
    for (const match of eligible.slice(0, offerFanout())) {
      const offerResult = await client.query(
        `INSERT INTO offers (load_id,carrier_id,truck_id,initial_rate,current_rate,maximum_rate,status,expires_at)
         VALUES ($1,$2,$3,$4,$4,$5,'PENDING',now()+($6 || ' minutes')::interval)
         RETURNING id,public_token`,
        [loadId, match.carrierId, match.truckId, targetCarrierRate, maxCarrierRate, offerTtlMinutes()]
      );
      const offerId = offerResult.rows[0].id;
      const publicToken = offerResult.rows[0].public_token;
      const payload = JSON.stringify({
        offerId,
        rate: targetCarrierRate,
        expiresInMinutes: offerTtlMinutes(),
        loadReference: load.reference_number,
        offerPath: `/carrier/offers/${publicToken}`
      });
      await client.query(
        `INSERT INTO outbox_messages (load_id,carrier_id,channel,recipient,template,payload)
         VALUES ($1,$2,'PUSH','carrier:' || $2::text,'LOAD_OFFER',$3::jsonb)`,
        [loadId, match.carrierId, payload]
      );
      await client.query(
        `INSERT INTO outbox_messages (load_id,carrier_id,channel,recipient,template,payload)
         SELECT $1,c.id,'EMAIL',c.dispatch_email,'LOAD_OFFER',$3::jsonb
         FROM carriers c
         WHERE c.id=$2 AND c.dispatch_email IS NOT NULL AND btrim(c.dispatch_email)<>''`,
        [loadId, match.carrierId, payload]
      );
      offersCreated += 1;
    }
    await client.query(`UPDATE loads SET status='OFFERING' WHERE id=$1`, [loadId]);
    await client.query(`INSERT INTO load_events (load_id,event_type,metadata) VALUES ($1,'OFFERS_CREATED',$2::jsonb)`, [loadId, JSON.stringify({ offersCreated, searchRadiusMiles: chosenRadius })]);
    await client.query("COMMIT");
    return { loadId, status: "OFFERING", searchRadiusMiles: chosenRadius, eligibleMatches: eligible.length, offersCreated };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function respondToOffer(offerId: string, response: OfferResponse, counterRate?: number) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT o.*, l.status AS load_status, l.shipper_rate, l.cargo_value,
              c.fraud_score, c.authority_status, c.insurance_status, c.banking_changed_at,
              c.onboarding_status,c.verification_expires_at,c.legal_name_verified
       FROM offers o
       JOIN loads l ON l.id=o.load_id
       JOIN carriers c ON c.id=o.carrier_id
       WHERE o.id=$1
       FOR UPDATE OF o,l`,
      [offerId]
    );
    const offer = result.rows[0];
    if (!offer) throw new Error("Offer not found");
    if (offer.load_status === "BOOKED") {
      await client.query(`UPDATE offers SET status='CANCELLED' WHERE id=$1 AND status<>'ACCEPTED'`, [offerId]);
      await client.query("COMMIT");
      return { action: "ALREADY_BOOKED" as const };
    }
    if (!["PENDING", "OPENED", "COUNTERED"].includes(offer.status)) throw new Error(`Offer cannot be changed from status ${offer.status}`);
    if (offer.expires_at && new Date(offer.expires_at).getTime() < Date.now()) {
      await client.query(`UPDATE offers SET status='EXPIRED',responded_at=now() WHERE id=$1`, [offerId]);
      const remaining = await activeOfferCount(client, offer.load_id);
      await client.query("COMMIT");
      return remaining === 0 ? { action: "EXPIRED" as const, recovery: await safeCapacityRecovery(offer.load_id) } : { action: "EXPIRED" as const };
    }

    if (response === "DECLINE") {
      await client.query(`UPDATE offers SET status='DECLINED',responded_at=now() WHERE id=$1`, [offerId]);
      await client.query(`UPDATE outbox_messages SET status='CANCELLED' WHERE load_id=$1 AND carrier_id=$2 AND status IN ('PENDING','WAITING_PROVIDER','WAITING_CONTACT','WAITING_SUBSCRIBER')`, [offer.load_id, offer.carrier_id]);
      await client.query(`INSERT INTO load_events (load_id,event_type,metadata) VALUES ($1,'OFFER_DECLINED',$2::jsonb)`, [offer.load_id, JSON.stringify({ offerId, carrierId: offer.carrier_id })]);
      const remaining = await activeOfferCount(client, offer.load_id);
      await client.query("COMMIT");
      return remaining === 0 ? { action: "DECLINED" as const, recovery: await safeCapacityRecovery(offer.load_id) } : { action: "DECLINED" as const };
    }

    let carrierRate = toNumber(offer.current_rate);
    if (response === "COUNTER") {
      if (!Number.isFinite(counterRate) || (counterRate ?? 0) <= 0) throw new Error("counterRate is required for a counter offer");
      carrierRate = counterRate as number;
      await client.query(`UPDATE offers SET current_rate=$2,status='COUNTERED',responded_at=now() WHERE id=$1`, [offerId, carrierRate]);
      if (carrierRate > toNumber(offer.maximum_rate)) {
        await createException(client, offer.load_id, "RATE", `Carrier counter of $${carrierRate.toFixed(2)} exceeds the autonomous ceiling of $${toNumber(offer.maximum_rate).toFixed(2)}.`, "Approve the higher rate or continue searching.");
        await client.query(`INSERT INTO automation_decisions (load_id,decision_type,inputs,decision) VALUES ($1,'OFFER_RESPONSE',$2::jsonb,$3::jsonb)`, [offer.load_id, JSON.stringify({ offerId, response, carrierRate }), JSON.stringify({ action: "MANUAL_REVIEW", reason: "RATE_CEILING" })]);
        await client.query("COMMIT");
        return { action: "MANUAL_REVIEW" as const, reason: "RATE_CEILING" };
      }
    }

    const verificationFresh = offer.onboarding_status === "VERIFIED"
      && offer.legal_name_verified === true
      && Boolean(offer.verification_expires_at)
      && new Date(offer.verification_expires_at).getTime() > Date.now();
    if (!verificationFresh) {
      await client.query(`UPDATE offers SET status='CANCELLED',responded_at=now() WHERE id=$1`, [offerId]);
      await createException(client, offer.load_id, "CARRIER_VERIFICATION", "Carrier verification is missing or stale at the moment of booking.", "Re-verify carrier authority, insurance, and legal identity before booking.", "HIGH");
      await client.query(
        `INSERT INTO automation_decisions (load_id,decision_type,inputs,decision)
         VALUES ($1,'BOOKING_DECISION',$2::jsonb,$3::jsonb)`,
        [offer.load_id, JSON.stringify({ offerId, carrierRate }), JSON.stringify({ action: "BLOCK", reason: "CARRIER_VERIFICATION_STALE" })]
      );
      await client.query("COMMIT");
      return { action: "BLOCK" as const, reason: "Carrier verification is missing or stale." };
    }

    const decision = decideBooking({
      shipperRate: toNumber(offer.shipper_rate),
      carrierRate,
      carrierFraudScore: toNumber(offer.fraud_score),
      authorityActive: offer.authority_status === "ACTIVE",
      insuranceValid: offer.insurance_status === "VALID",
      bankingChangedWithin48Hours: Boolean(offer.banking_changed_at) && Date.now() - new Date(offer.banking_changed_at).getTime() < 48 * 3_600_000,
      cargoValue: toNumber(offer.cargo_value)
    });

    await client.query(
      `INSERT INTO automation_decisions (load_id,decision_type,inputs,rules_used,decision)
       VALUES ($1,'BOOKING_DECISION',$2::jsonb,$3::jsonb,$4::jsonb)`,
      [offer.load_id, JSON.stringify({ offerId, response, carrierRate }), JSON.stringify({ maximumRate: toNumber(offer.maximum_rate), verificationFresh: true }), JSON.stringify(decision)]
    );

    if (decision.action === "BLOCK") {
      await client.query(`UPDATE offers SET status='CANCELLED',responded_at=now() WHERE id=$1`, [offerId]);
      await createException(client, offer.load_id, "CARRIER_RISK", decision.reason, "Do not book until carrier eligibility is re-verified.", "HIGH");
      await client.query("COMMIT");
      return decision;
    }

    if (decision.action === "MANUAL_REVIEW") {
      await createException(client, offer.load_id, "BOOKING_REVIEW", decision.reason, "Review and approve or continue carrier search.");
      await client.query("COMMIT");
      return decision;
    }

    await client.query(`INSERT INTO bookings (load_id,carrier_id,truck_id,carrier_rate) VALUES ($1,$2,$3,$4)`, [offer.load_id, offer.carrier_id, offer.truck_id, carrierRate]);
    await client.query(`UPDATE loads SET status='BOOKED',booked_at=now() WHERE id=$1`, [offer.load_id]);
    await client.query(`UPDATE offers SET status=CASE WHEN id=$2 THEN 'ACCEPTED'::offer_status ELSE 'CANCELLED'::offer_status END,responded_at=CASE WHEN id=$2 THEN now() ELSE responded_at END WHERE load_id=$1 AND status IN ('PENDING','OPENED','COUNTERED')`, [offer.load_id, offerId]);
    await client.query(`UPDATE outbox_messages SET status='CANCELLED' WHERE load_id=$1 AND carrier_id<>$2 AND status IN ('PENDING','WAITING_PROVIDER','WAITING_CONTACT','WAITING_SUBSCRIBER')`, [offer.load_id, offer.carrier_id]);
    if (offer.truck_id) await client.query(`UPDATE trucks SET status='DISPATCHED' WHERE id=$1`, [offer.truck_id]);
    await client.query(`INSERT INTO load_events (load_id,event_type,metadata) VALUES ($1,'CARRIER_BOOKED',$2::jsonb)`, [offer.load_id, JSON.stringify({ offerId, carrierId: offer.carrier_id, carrierRate })]);
    await client.query("COMMIT");
    return decision;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
