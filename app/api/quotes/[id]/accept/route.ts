import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { runAutopilot } from "@/lib/workflow";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const quoteResult = await client.query(`SELECT * FROM quotes WHERE id=$1 FOR UPDATE`, [id]);
    const quote = quoteResult.rows[0];
    if (!quote) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Quote not found" }, { status: 404 }); }
    if (quote.status !== "OPEN") { await client.query("ROLLBACK"); return NextResponse.json({ error: `Quote is ${quote.status}` }, { status: 409 }); }
    if (new Date(quote.expires_at).getTime() < Date.now()) {
      await client.query(`UPDATE quotes SET status='EXPIRED' WHERE id=$1`, [id]);
      await client.query("COMMIT");
      return NextResponse.json({ error: "Quote expired" }, { status: 409 });
    }

    const reference = `AL-${Date.now().toString().slice(-8)}`;
    const loadResult = await client.query(
      `INSERT INTO loads (
         quote_id,reference_number,status,origin_city,origin_state,origin_location,
         destination_city,destination_state,destination_location,pickup_start,
         equipment_type,weight_lbs,commodity,cargo_value,shipper_rate,target_carrier_rate,max_carrier_rate
       )
       SELECT id,$2,'SEARCHING',origin_city,origin_state,origin_location,
              destination_city,destination_state,destination_location,pickup_start,
              equipment_type,weight_lbs,commodity,cargo_value,shipper_price,target_carrier_rate,max_carrier_rate
       FROM quotes WHERE id=$1
       RETURNING *`,
      [id, reference]
    );
    await client.query(`UPDATE quotes SET status='ACCEPTED',accepted_at=now() WHERE id=$1`, [id]);
    await client.query(`INSERT INTO load_events (load_id,event_type,metadata) VALUES ($1,'QUOTE_ACCEPTED',$2::jsonb)`, [loadResult.rows[0].id, JSON.stringify({ quoteId: id, shipperPrice: Number(quote.shipper_price) })]);
    await client.query("COMMIT");

    const autopilot = await runAutopilot(loadResult.rows[0].id);
    return NextResponse.json({ load: loadResult.rows[0], autopilot }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to accept quote" }, { status: 500 });
  } finally { client.release(); }
}
