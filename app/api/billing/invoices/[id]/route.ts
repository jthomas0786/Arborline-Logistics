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
      `SELECT i.*,l.reference_number,s.billing_email
       FROM shipper_invoices i
       JOIN loads l ON l.id=i.load_id
       JOIN shippers s ON s.id=i.shipper_id
       WHERE i.id=$1
       FOR UPDATE OF i`,
      [id]
    );
    const invoice = rows[0];
    if (!invoice) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }

    if (action === "QUEUE") {
      if (!invoice.billing_email) {
        await client.query(
          `INSERT INTO exceptions (load_id,severity,category,description,recommended_action,status)
           SELECT $1,'HIGH','BILLING_CONTACT',$2,$3,'OPEN'
           WHERE NOT EXISTS (
             SELECT 1 FROM exceptions WHERE load_id=$1 AND category='BILLING_CONTACT' AND status IN ('OPEN','ACKNOWLEDGED')
           )`,
          [invoice.load_id, "Invoice cannot be sent because the shipper billing email is missing.", "Add a billing email to the shipper account, then queue the invoice again."]
        );
        await client.query("COMMIT");
        return NextResponse.json({ error: "Shipper billing email is missing. A BILLING_CONTACT exception was opened." }, { status: 409 });
      }

      await client.query(
        `INSERT INTO outbox_messages (load_id,channel,recipient,template,payload,status,available_at)
         SELECT $1,'EMAIL',$2,'SHIPPER_INVOICE',$3::jsonb,'PENDING',now()
         WHERE NOT EXISTS (
           SELECT 1 FROM outbox_messages
           WHERE load_id=$1 AND channel='EMAIL' AND recipient=$2 AND template='SHIPPER_INVOICE'
             AND status IN ('PENDING','PROCESSING','WAITING_PROVIDER','SENT')
         )`,
        [invoice.load_id, invoice.billing_email, JSON.stringify({ invoiceNumber: invoice.invoice_number, loadReference: invoice.reference_number, amount: Number(invoice.amount), dueAt: invoice.due_at })]
      );
      await client.query(`UPDATE shipper_invoices SET queued_at=COALESCE(queued_at,now()) WHERE id=$1`, [id]);
      await client.query(`UPDATE exceptions SET status='RESOLVED',resolved_at=now() WHERE load_id=$1 AND category='BILLING_CONTACT' AND status IN ('OPEN','ACKNOWLEDGED')`, [invoice.load_id]);
      await client.query(
        `INSERT INTO financial_events (load_id,invoice_id,event_type,direction,amount,is_test,actor_user_id,metadata)
         VALUES ($1,$2,'INVOICE_QUEUED','AR',$3,true,$4,$5::jsonb)`,
        [invoice.load_id, id, invoice.amount, auth.identity.userId, JSON.stringify({ recipient: invoice.billing_email })]
      );
      await client.query("COMMIT");
      return NextResponse.json({ ok: true, status: "QUEUED", recipient: invoice.billing_email });
    }

    if (action === "MARK_PAID") {
      if (body.isTest === false) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Real payment recording is disabled until a payment provider is connected." }, { status: 409 });
      }
      if (invoice.status === "VOID" || invoice.status === "DRAFT") {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: `Invoice cannot be paid while ${invoice.status}.` }, { status: 409 });
      }

      if (invoice.status !== "PAID") {
        const method = String(body.method ?? "TEST_ACH").slice(0, 40);
        const reference = String(body.reference ?? `TEST-AR-${Date.now()}`).slice(0, 120);
        await client.query(
          `UPDATE shipper_invoices SET status='PAID',paid_at=now(),payment_method=$2,payment_reference=$3 WHERE id=$1`,
          [id, method, reference]
        );
        await client.query(
          `INSERT INTO financial_events (load_id,invoice_id,event_type,direction,amount,method,reference,is_test,actor_user_id)
           VALUES ($1,$2,'SHIPPER_PAYMENT_RECORDED','AR',$3,$4,$5,true,$6)`,
          [invoice.load_id, id, invoice.amount, method, reference, auth.identity.userId]
        );
        await client.query(
          `INSERT INTO load_events (load_id,event_type,source,metadata)
           VALUES ($1,'SHIPPER_PAYMENT_RECORDED','SYSTEM',$2::jsonb)`,
          [invoice.load_id, JSON.stringify({ invoiceId: id, amount: Number(invoice.amount), method, reference, testMode: true })]
        );
      }

      const closeout = await advanceFinancialCloseout(client, invoice.load_id, auth.identity.userId);
      await client.query("COMMIT");
      return NextResponse.json({ ok: true, invoiceStatus: "PAID", closeout, testMode: true });
    }

    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Unsupported invoice action." }, { status: 400 });
  } catch (error) {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update invoice." }, { status: 500 });
  } finally {
    client.release();
  }
}
