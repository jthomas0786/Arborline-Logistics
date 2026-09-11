import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { processCarrierVerificationQueue, queueCarrierVerification } from "@/lib/carrier-verification";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireApiRole(["STAFF"]);
  if (!access.identity) return NextResponse.json({ error: access.error }, { status: access.status });
  const { id } = await context.params;
  const { rows } = await getPool().query(`SELECT id,is_test_carrier FROM carriers WHERE id=$1`, [id]);
  if (!rows[0]) return NextResponse.json({ error: "Carrier not found" }, { status: 404 });
  if (rows[0].is_test_carrier) return NextResponse.json({ error: "TEST ONLY carriers use the synthetic test override and are not sent to FMCSA." }, { status: 409 });

  const queued = await queueCarrierVerification(id, `STAFF:${access.identity.userId}`);
  const processed = await processCarrierVerificationQueue(1);
  const result = await getPool().query(
    `SELECT c.onboarding_status,c.authority_status,c.insurance_status,c.verification_source,c.verification_expires_at,
            c.compliance_hold_reason,v.status verification_status,v.last_error
     FROM carriers c
     LEFT JOIN LATERAL (
       SELECT status,last_error FROM carrier_verification_checks WHERE carrier_id=c.id ORDER BY created_at DESC LIMIT 1
     ) v ON true
     WHERE c.id=$1`,
    [id]
  );
  return NextResponse.json({ queued, processed, carrier: result.rows[0] });
}
