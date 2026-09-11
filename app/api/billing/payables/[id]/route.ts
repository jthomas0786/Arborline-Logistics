import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { advanceFinancialCloseout } from "@/lib/financial-closeout";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["STAFF"]);
  if (!auth.identity) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const action = String(body.action ?? "").toUpperCase();
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT p.*,l.reference_number
       FROM carrier_payables p
       JOIN loads l ON l.id=p.load_id
       WHERE p.id=$1
       FOR UPDATE OF p`,
      [id]
    );
    const payable = rows[0];
    if (!payable) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Carrier payable not found." }, { status: 404 });
    }

    if (action === "HOLD") {
      if (payable.status === "PAID" || payable.status === "VOID") {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: `Payable cannot be held while ${payable.status}.` }, { status: 409 });
      }
      const reason = String(body.reason ?? "Staff review required").trim().slice(0, 500) || "Staff review required";
      await client.query(`UPDATE carrier_payables SET status='HOLD',hold_reason=$2,scheduled_at=NULL WHERE id=$1`, [id, reason]);
      await client.query(
        `INSERT INTO financial_events (load_id,payable_id,event_type,direction,amount,is_test,actor_user_id,metadata)
         VALUES ($1,$2,'PAYABLE_HELD','AP',$3,true,$4,$5::jsonb)`,
        [payable.load_id, id, payable.amount, auth.identity.userId, JSON.stringify({ reason })]
      );
      await client.query("COMMIT");
      return NextResponse.json({ ok: true, payableStatus: "HOLD", reason });
    }

    if (action === "RELEASE") {
      if (payable.status !== "HOLD") {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Only held payables can be released." }, { status: 409 });
      }
      await client.query(`UPDATE carrier_payables SET status='READY',hold_reason=NULL WHERE id=$1`, [id]);
      await client.query(
        `INSERT INTO financial_events (load_id,payable_id,event_type,direction,amount,is_test,actor_user_id)
         VALUES ($1,$2,'PAYABLE_RELEASED','AP',$3,true,$4)`,
        [payable.load_id, id, payable.amount, auth.identity.userId]
      );
      await client.query("COMMIT");
      return NextResponse.json({ ok: true, payableStatus: "READY" });
    }

    if (action === "MARK_PAID") {
      if (body.isTest === false) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Real carrier payment is disabled until a payment provider is connected." }, { status: 409 });
      }
      if (payable.status === "HOLD") {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Release the payment hold before recording carrier payment." }, { status: 409 });
      }
      if (payable.status === "VOID") {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Void payables cannot be paid." }, { status: 409 });
      }

      if (payable.status !== "PAID") {
        const method = String(body.method ?? "TEST_ACH").slice(0, 40);
        const reference = String(body.reference ?? `TEST-AP-${Date.now()}`).slice(0, 120);
        await client.query(
          `UPDATE carrier_payables SET status='PAID',paid_at=now(),payment_method=$2,payment_reference=$3 WHERE id=$1`,
          [id, method, reference]
        );
        await client.query(
          `INSERT INTO financial_events (load_id,payable_id,event_type,direction,amount,method,reference,is_test,actor_user_id)
           VALUES ($1,$2,'CARRIER_PAYMENT_RECORDED','AP',$3,$4,$5,true,$6)`,
          [payable.load_id, id, payable.amount, method, reference, auth.identity.userId]
        );
        await client.query(
          `INSERT INTO load_events (load_id,event_type,source,metadata)
           VALUES ($1,'CARRIER_PAYMENT_RECORDED','SYSTEM',$2::jsonb)`,
          [payable.load_id, JSON.stringify({ payableId: id, amount: Number(payable.amount), method, reference, testMode: true })]
        );
      }

      const closeout = await advanceFinancialCloseout(client, payable.load_id, auth.identity.userId);
      await client.query("COMMIT");
      return NextResponse.json({ ok: true, payableStatus: "PAID", closeout, testMode: true });
    }

    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Unsupported payable action." }, { status: 400 });
  } catch (error) {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update carrier payable." }, { status: 500 });
  } finally {
    client.release();
  }
}
