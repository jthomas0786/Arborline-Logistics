import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { verifyConnectSamplesViewToken } from "@/lib/connect-outreach-tracking";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { token?: unknown } = {};
  try {
    body = await request.json() as { token?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim().slice(0, 500) : "";
  const messageId = token ? verifyConnectSamplesViewToken(token) : null;
  if (!messageId) return NextResponse.json({ error: "Invalid tracking token." }, { status: 400 });

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE connect_outreach_messages
       SET sample_viewed_at=COALESCE(sample_viewed_at,now()),
           sample_view_count=sample_view_count+1,
           updated_at=now()
       WHERE id=$1
         AND experiment_key='alc_samples_link_v1'
         AND experiment_variant='SAMPLES_LINK'
         AND status IN ('SENT','DELIVERED')
       RETURNING prospect_id`,
      [messageId]
    );

    const prospectId = updated.rows[0]?.prospect_id;
    if (prospectId) {
      await client.query(
        `UPDATE connect_prospects
         SET buying_signals=CASE
               WHEN 'SAMPLES_VIEWED'=ANY(buying_signals) THEN buying_signals
               ELSE array_append(buying_signals,'SAMPLES_VIEWED')
             END,
             updated_at=now()
         WHERE id=$1`,
        [prospectId]
      );
    }

    await client.query("COMMIT");
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  } catch (error) {
    await client.query("ROLLBACK");
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to record Samples view." },
      { status: 500, headers: { "cache-control": "no-store" } }
    );
  } finally {
    client.release();
  }
}
