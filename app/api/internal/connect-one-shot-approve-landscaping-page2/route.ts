import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

const EXPECTED_HASH = "31b8b555a9904b0cc40edd14b82db9e4651e172af91c1d3d556396741da15346";
const SEGMENT_ID = "83068e29-4ffb-4756-9f78-5c741db63968";
const COMPANIES = [
  "Beary Landscaping",
  "Calvin Landscape",
  "Christy Webber Landscapes",
  "Landscape Concepts Management",
  "Midwest Landscape Industries, Inc.",
  "Reinhart Landscaping & Snow"
];

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqualHex(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token")?.trim() ?? "";
  if (!token || !safeEqualHex(sha256(token), EXPECTED_HASH)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const pool = getPool();
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const current = await db.query(
      `SELECT m.id AS message_id,m.status AS message_status,p.id AS prospect_id,p.company_name,
              p.outreach_status,p.qualification_status,p.suppression_status
       FROM connect_outreach_messages m
       JOIN connect_prospects p ON p.id=m.prospect_id
       WHERE p.segment_id=$1
         AND p.company_name=ANY($2::text[])
         AND m.created_at >= '2026-09-15T19:37:00Z'::timestamptz
         AND m.status IN ('DRAFT','QUEUED')
         AND p.qualification_status='QUALIFIED'
         AND p.suppression_status='CLEAR'
         AND p.contact_email IS NOT NULL
         AND lower(p.contact_email)=lower(m.recipient_email)
         AND NOT EXISTS (
           SELECT 1 FROM connect_suppressions s
           WHERE (s.client_id IS NULL OR s.client_id=p.client_id)
             AND ((s.email IS NOT NULL AND lower(s.email)=lower(p.contact_email))
               OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain)))
         )
       ORDER BY p.company_name
       FOR UPDATE OF m,p`,
      [SEGMENT_ID, COMPANIES]
    );

    if (current.rows.length !== 6) {
      await db.query("ROLLBACK");
      return NextResponse.json({ error: "Expected exactly 6 safe page-2 messages.", found: current.rows.length }, { status: 409 });
    }

    const invalid = current.rows.filter((row) =>
      !((row.message_status === 'DRAFT' && row.outreach_status === 'READY') ||
        (row.message_status === 'QUEUED' && row.outreach_status === 'QUEUED'))
    );
    if (invalid.length) {
      await db.query("ROLLBACK");
      return NextResponse.json({ error: "Unexpected approval state.", invalid: invalid.map((row) => ({ company: row.company_name, messageStatus: row.message_status, outreachStatus: row.outreach_status })) }, { status: 409 });
    }

    const draftRows = current.rows.filter((row) => row.message_status === 'DRAFT');
    if (draftRows.length) {
      const messageIds = draftRows.map((row) => row.message_id);
      const prospectIds = draftRows.map((row) => row.prospect_id);
      await db.query(
        `UPDATE connect_outreach_messages SET status='QUEUED',updated_at=now() WHERE id=ANY($1::uuid[]) AND status='DRAFT'`,
        [messageIds]
      );
      await db.query(
        `UPDATE connect_prospects SET outreach_status='QUEUED',updated_at=now() WHERE id=ANY($1::uuid[]) AND outreach_status='READY'`,
        [prospectIds]
      );
    }

    await db.query("COMMIT");
    return NextResponse.json({
      ok: true,
      newlyApproved: draftRows.length,
      alreadyQueued: current.rows.length - draftRows.length,
      totalQueued: current.rows.length,
      companies: current.rows.map((row) => row.company_name)
    });
  } catch (error) {
    await db.query("ROLLBACK");
    const message = error instanceof Error ? error.message : "Unknown approval error";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    db.release();
  }
}
