import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

const allowedEquipment = new Set(["DRY_VAN","REEFER","FLATBED"]);
const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const body = await request.json();
  const legalName = String(body.legalName ?? "").trim();
  const usdot = digits(body.usdotNumber);
  const mc = digits(body.mcNumber);
  const dispatchPhone = String(body.dispatchPhone ?? "").trim() || null;
  const dispatchEmail = String(body.dispatchEmail ?? "").trim().toLowerCase() || null;
  const equipmentInput: unknown[] = Array.isArray(body.equipment) ? body.equipment : [];
  const equipment = [...new Set(equipmentInput.map((item) => String(item)).filter((item) => allowedEquipment.has(item)))];

  if (legalName.length < 2) return NextResponse.json({ error: "Legal company name is required" }, { status: 400 });
  if (!/^\d{1,10}$/.test(usdot)) return NextResponse.json({ error: "A valid USDOT number is required" }, { status: 400 });
  if (!/^\d{1,10}$/.test(mc)) return NextResponse.json({ error: "A valid MC number is required" }, { status: 400 });
  if (!dispatchPhone && !dispatchEmail) return NextResponse.json({ error: "A dispatch phone or email is required" }, { status: 400 });
  if (!equipment.length) return NextResponse.json({ error: "Select at least one equipment type" }, { status: 400 });

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const inviteResult = await client.query(`SELECT * FROM carrier_invites WHERE public_token=$1 FOR UPDATE`, [token]);
    const invite = inviteResult.rows[0];
    if (!invite) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Invite not found" }, { status: 404 }); }
    if (invite.status !== "PENDING") { await client.query("ROLLBACK"); return NextResponse.json({ error: `Invite is ${invite.status.toLowerCase()}` }, { status: 409 }); }
    if (new Date(invite.expires_at).getTime() <= Date.now()) {
      await client.query(`UPDATE carrier_invites SET status='EXPIRED' WHERE id=$1`, [invite.id]);
      await client.query("COMMIT");
      return NextResponse.json({ error: "Invite expired" }, { status: 410 });
    }

    const duplicate = await client.query(`SELECT id FROM carriers WHERE usdot_number=$1 OR mc_number=$2 LIMIT 1`, [usdot, mc]);
    if (duplicate.rows[0]) { await client.query("ROLLBACK"); return NextResponse.json({ error: "This carrier is already registered. Contact Arborline if access needs to be restored." }, { status: 409 }); }

    const orgResult = await client.query(`INSERT INTO organizations (type,legal_name) VALUES ('CARRIER',$1) RETURNING id`, [legalName]);
    const carrierResult = await client.query(
      `INSERT INTO carriers (organization_id,usdot_number,mc_number,authority_status,insurance_status,onboarding_status,verification_source,dispatch_phone,dispatch_email)
       VALUES ($1,$2,$3,'PENDING','PENDING','VERIFICATION_PENDING','FMCSA_QCMOBILE',$4,$5)
       RETURNING id,onboarding_status`,
      [orgResult.rows[0].id, usdot, mc, dispatchPhone, dispatchEmail]
    );
    const carrier = carrierResult.rows[0];
    for (const equipmentType of equipment) {
      await client.query(`INSERT INTO carrier_equipment_profiles (carrier_id,equipment_type) VALUES ($1,$2)`, [carrier.id, equipmentType]);
    }
    const verification = await client.query(
      `INSERT INTO carrier_verification_checks (carrier_id,provider,status) VALUES ($1,'FMCSA_QCMOBILE','PENDING') RETURNING id`,
      [carrier.id]
    );
    await client.query(
      `INSERT INTO carrier_compliance_events (carrier_id,verification_check_id,event_type,source,details)
       VALUES ($1,$2,'VERIFICATION_QUEUED','CARRIER_ONBOARDING',$3::jsonb)`,
      [carrier.id, verification.rows[0].id, JSON.stringify({ usdotNumber: usdot, mcNumber: mc })]
    );
    await client.query(`UPDATE carrier_invites SET status='SUBMITTED',carrier_id=$2,submitted_at=now() WHERE id=$1`, [invite.id, carrier.id]);
    await client.query("COMMIT");
    return NextResponse.json({ carrier: { id: carrier.id, onboardingStatus: carrier.onboarding_status }, message: "Carrier submitted for FMCSA and insurance verification." }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to submit carrier" }, { status: 400 });
  } finally { client.release(); }
}
