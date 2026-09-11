import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

const MAX_POD_BYTES = 4_000_000;

function detectDocumentType(bytes: Buffer) {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(png)) return "image/png";
  return null;
}

function safeFileName(value: string) {
  const cleaned = value.replace(/[^a-zA-Z0-9._ -]/g, "_").trim().slice(0, 180);
  return cleaned || "pod";
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Upload a POD file using multipart form data." }, { status: 400 });
  }

  const candidate = form.get("pod");
  if (!(candidate instanceof File)) return NextResponse.json({ error: "A POD file is required." }, { status: 400 });
  if (candidate.size <= 0) return NextResponse.json({ error: "The POD file is empty." }, { status: 400 });
  if (candidate.size > MAX_POD_BYTES) return NextResponse.json({ error: "POD files are limited to 4 MB in the current MVP." }, { status: 413 });

  const bytes = Buffer.from(await candidate.arrayBuffer());
  const detectedContentType = detectDocumentType(bytes);
  if (!detectedContentType) return NextResponse.json({ error: "POD must be a valid PDF, JPEG, or PNG file." }, { status: 415 });
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT b.id booking_id,b.load_id,b.carrier_id,b.carrier_rate,
              l.reference_number,l.status,l.shipper_id,l.shipper_rate,
              COALESCE(s.payment_terms_days,30) payment_terms_days
       FROM bookings b
       JOIN loads l ON l.id=b.load_id
       LEFT JOIN shippers s ON s.id=l.shipper_id
       WHERE b.tracking_token=$1
       FOR UPDATE OF b,l`,
      [token]
    );
    const record = rows[0];
    if (!record) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Tracking link not found." }, { status: 404 });
    }

    const existing = await client.query(
      `SELECT d.id,d.sha256,i.invoice_number
       FROM load_documents d
       LEFT JOIN shipper_invoices i ON i.load_id=d.load_id
       WHERE d.load_id=$1 AND d.document_type='POD' AND d.status='VALIDATED'
       LIMIT 1`,
      [record.load_id]
    );
    if (existing.rows[0]) {
      await client.query("COMMIT");
      return NextResponse.json({
        ok: true,
        alreadyReceived: true,
        documentId: existing.rows[0].id,
        invoiceNumber: existing.rows[0].invoice_number ?? null,
        status: record.status
      });
    }

    if (!["DELIVERED","POD_RECEIVED","INVOICED"].includes(record.status)) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: `POD cannot be submitted while the load is ${record.status}.` }, { status: 409 });
    }
    if (!record.shipper_id || record.shipper_rate === null || record.shipper_rate === undefined) throw new Error("Shipper billing data is incomplete for this load.");
    if (record.carrier_rate === null || record.carrier_rate === undefined) throw new Error("Carrier settlement data is incomplete for this load.");

    const documentResult = await client.query(
      `INSERT INTO load_documents
        (load_id,booking_id,document_type,status,file_name,content_type,file_size_bytes,sha256,content,uploaded_via,validation_notes,validated_at)
       VALUES ($1,$2,'POD','VALIDATED',$3,$4,$5,$6,$7,'DRIVER_LINK',$8::jsonb,now())
       RETURNING id`,
      [
        record.load_id,
        record.booking_id,
        safeFileName(candidate.name),
        detectedContentType,
        bytes.length,
        sha256,
        bytes,
        JSON.stringify({ magicBytesVerified: true, acceptedType: detectedContentType, maxBytes: MAX_POD_BYTES })
      ]
    );

    await client.query(`UPDATE loads SET status='POD_RECEIVED' WHERE id=$1`, [record.load_id]);
    await client.query(
      `INSERT INTO load_events (load_id,event_type,source,metadata)
       VALUES ($1,'POD_RECEIVED','DRIVER',$2::jsonb)`,
      [record.load_id, JSON.stringify({ documentId: documentResult.rows[0].id, fileName: safeFileName(candidate.name), sha256 })]
    );

    const invoiceNumber = `INV-${String(record.reference_number).replace(/[^a-zA-Z0-9-]/g, "")}`;
    const invoiceInsert = await client.query(
      `INSERT INTO shipper_invoices (load_id,shipper_id,invoice_number,amount,status,issued_at,due_at)
       VALUES ($1,$2,$3,$4,'ISSUED',now(),now()+($5::int * interval '1 day'))
       ON CONFLICT (load_id) DO NOTHING
       RETURNING id,invoice_number`,
      [record.load_id, record.shipper_id, invoiceNumber, record.shipper_rate, Number(record.payment_terms_days)]
    );
    const invoice = invoiceInsert.rows[0] ?? (await client.query(`SELECT id,invoice_number FROM shipper_invoices WHERE load_id=$1`, [record.load_id])).rows[0];

    const payableInsert = await client.query(
      `INSERT INTO carrier_payables (load_id,booking_id,carrier_id,amount,status,eligible_at)
       VALUES ($1,$2,$3,$4,'READY',now())
       ON CONFLICT (load_id) DO NOTHING
       RETURNING id`,
      [record.load_id, record.booking_id, record.carrier_id, record.carrier_rate]
    );
    const payable = payableInsert.rows[0] ?? (await client.query(`SELECT id FROM carrier_payables WHERE load_id=$1`, [record.load_id])).rows[0];

    await client.query(`UPDATE loads SET status='INVOICED' WHERE id=$1`, [record.load_id]);
    await client.query(
      `INSERT INTO load_events (load_id,event_type,metadata)
       VALUES ($1,'SHIPPER_INVOICE_CREATED',$2::jsonb),
              ($1,'CARRIER_PAYABLE_CREATED',$3::jsonb),
              ($1,'INVOICED',$4::jsonb)`,
      [
        record.load_id,
        JSON.stringify({ invoiceId: invoice.id, invoiceNumber: invoice.invoice_number }),
        JSON.stringify({ payableId: payable.id }),
        JSON.stringify({ invoiceId: invoice.id, payableId: payable.id })
      ]
    );

    await client.query("COMMIT");
    return NextResponse.json({
      ok: true,
      documentId: documentResult.rows[0].id,
      podStatus: "VALIDATED",
      status: "INVOICED",
      invoiceNumber: invoice.invoice_number
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to process POD." }, { status: 500 });
  } finally {
    client.release();
  }
}
