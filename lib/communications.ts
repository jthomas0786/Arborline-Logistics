import { createHmac, timingSafeEqual } from "crypto";
import { buildInvoicePdf } from "./invoice-pdf";
import { getPool } from "./db";

export type OutboxMessage = {
  id: string | number;
  load_id: string | null;
  carrier_id: string | null;
  channel: string;
  recipient: string;
  template: string;
  payload: Record<string, unknown>;
  attempts: number;
};

export class CommunicationProviderError extends Error {
  statusCode: number | null;
  constructor(message: string, statusCode: number | null = null) {
    super(message);
    this.name = "CommunicationProviderError";
    this.statusCode = statusCode;
  }
}

export function deploymentBaseUrl() {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`.replace(/\/$/, "");
  return "http://localhost:3000";
}

export function communicationsConfig() {
  return {
    emailReady: Boolean(process.env.RESEND_API_KEY?.trim() && process.env.RESEND_FROM_EMAIL?.trim() && process.env.RESEND_WEBHOOK_SECRET?.trim())
  };
}

export function isTestRecipient(recipient: string) {
  const value = recipient.trim().toLowerCase();
  if (value.endsWith(".invalid")) return true;
  if (/^\+?1?55501\d{4}$/.test(value.replace(/[^\d+]/g, ""))) return true;
  return false;
}

function absoluteActionUrl(payload: Record<string, unknown>) {
  const candidate = typeof payload.actionUrl === "string"
    ? payload.actionUrl
    : typeof payload.offerPath === "string"
      ? payload.offerPath
      : typeof payload.invitePath === "string"
        ? payload.invitePath
        : typeof payload.trackingPath === "string"
          ? payload.trackingPath
          : null;
  if (!candidate) return null;
  if (/^https?:\/\//i.test(candidate)) return candidate;
  return `${deploymentBaseUrl()}${candidate.startsWith("/") ? candidate : `/${candidate}`}`;
}

function money(value: unknown) {
  const amount = Number(value ?? 0);
  return `$${Number.isFinite(amount) ? amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}`;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

export function renderCommunication(message: OutboxMessage) {
  const payload = message.payload ?? {};
  const actionUrl = absoluteActionUrl(payload);
  const loadReference = String(payload.loadReference ?? payload.referenceNumber ?? "").trim();

  if (message.template === "LOAD_OFFER") {
    const rate = money(payload.rate);
    const expires = Number(payload.expiresInMinutes ?? 15);
    const text = `Arborline load offer${loadReference ? ` ${loadReference}` : ""}: ${rate}. ${actionUrl ? `Respond: ${actionUrl}. ` : ""}Expires in ${Number.isFinite(expires) ? expires : 15} minutes.`;
    return { subject: `Arborline load offer${loadReference ? ` — ${loadReference}` : ""}`, text, html: `<p>${escapeHtml(text)}</p>` };
  }

  if (message.template === "DRIVER_TRACKING") {
    const text = `Arborline driver link${loadReference ? ` for ${loadReference}` : ""}.${actionUrl ? ` Open: ${actionUrl}` : ""}`;
    return { subject: `Arborline driver link${loadReference ? ` — ${loadReference}` : ""}`, text, html: `<p>${escapeHtml(text)}</p>` };
  }

  if (message.template === "CARRIER_INVITE") {
    const text = `You have been invited to onboard with Arborline Logistics.${actionUrl ? ` Start onboarding: ${actionUrl}` : ""}`;
    return { subject: "Arborline carrier onboarding invitation", text, html: `<p>${escapeHtml(text)}</p>` };
  }

  if (message.template === "SHIPPER_INVOICE") {
    const invoiceNumber = String(payload.invoiceNumber ?? "Invoice");
    const amount = money(payload.amount);
    const dueAt = payload.dueAt ? new Date(String(payload.dueAt)).toLocaleDateString("en-US") : "the stated due date";
    const text = `Arborline invoice ${invoiceNumber}${loadReference ? ` for load ${loadReference}` : ""}: ${amount}, due ${dueAt}. The invoice PDF is attached. Payment instructions are provided through approved billing channels.`;
    return { subject: `Arborline invoice ${invoiceNumber}${loadReference ? ` — ${loadReference}` : ""}`, text, html: `<p>${escapeHtml(text)}</p>` };
  }

  const text = `Arborline Logistics notification${loadReference ? ` for ${loadReference}` : ""}.${actionUrl ? ` Open: ${actionUrl}` : ""}`;
  return { subject: "Arborline Logistics notification", text, html: `<p>${escapeHtml(text)}</p>` };
}

async function invoiceAttachment(message: OutboxMessage) {
  if (message.template !== "SHIPPER_INVOICE") return null;
  const invoiceId = typeof message.payload.invoiceId === "string" ? message.payload.invoiceId : null;
  const { rows } = await getPool().query(
    `SELECT i.invoice_number,i.amount,i.status,i.issued_at,i.due_at,
            l.reference_number,l.origin_city,l.origin_state,l.destination_city,l.destination_state,
            o.legal_name shipper_name
     FROM shipper_invoices i
     JOIN loads l ON l.id=i.load_id
     JOIN shippers s ON s.id=i.shipper_id
     JOIN organizations o ON o.id=s.organization_id
     WHERE ($1::uuid IS NOT NULL AND i.id=$1::uuid) OR ($1::uuid IS NULL AND i.load_id=$2::uuid)
     ORDER BY i.issued_at DESC LIMIT 1`,
    [invoiceId, message.load_id]
  );
  const invoice = rows[0];
  if (!invoice) throw new CommunicationProviderError("Invoice attachment could not be generated because the invoice record was not found.");
  const lines = [
    "ARBORLINE LOGISTICS",
    "FREIGHT INVOICE",
    "",
    `Invoice: ${invoice.invoice_number}`,
    `Load: ${invoice.reference_number}`,
    `Bill to: ${invoice.shipper_name}`,
    `Lane: ${invoice.origin_city}, ${invoice.origin_state} -> ${invoice.destination_city}, ${invoice.destination_state}`,
    `Invoice amount: ${money(invoice.amount)}`,
    `Issued: ${new Date(invoice.issued_at).toLocaleDateString("en-US")}`,
    `Due: ${new Date(invoice.due_at).toLocaleDateString("en-US")}`,
    `Status: ${invoice.status}`,
    "",
    "This invoice was generated by Arborline Logistics.",
    "Payment instructions are supplied separately through approved billing channels."
  ];
  const pdf = buildInvoicePdf(lines);
  return {
    filename: `${String(invoice.invoice_number).replace(/[^a-zA-Z0-9-]/g, "_")}.pdf`,
    content: pdf.toString("base64")
  };
}

export async function sendWithResend(message: OutboxMessage) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from || !process.env.RESEND_WEBHOOK_SECRET?.trim()) throw new CommunicationProviderError("Resend is not fully configured.");
  const rendered = renderCommunication(message);
  const attachment = await invoiceAttachment(message);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "Idempotency-Key": `arborline-outbox-${message.id}`
    },
    body: JSON.stringify({
      from,
      to: [message.recipient],
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      ...(attachment ? { attachments: [attachment] } : {})
    })
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new CommunicationProviderError(String(body.message ?? body.name ?? `Resend returned ${response.status}`), response.status);
  const id = String(body.id ?? "");
  if (!id) throw new CommunicationProviderError("Resend accepted the request without returning a message id.");
  return { provider: "RESEND", providerMessageId: id, providerStatus: "accepted", metadata: {} as Record<string, unknown> };
}

function decodeWebhookSecret(secret: string) {
  const normalized = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  return Buffer.from(normalized, "base64");
}

export function verifyResendWebhook(rawBody: string, headers: Headers) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatureHeader = headers.get("svix-signature");
  if (!secret || !id || !timestamp || !signatureHeader) return false;
  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber) || Math.abs(Date.now() / 1000 - timestampNumber) > 300) return false;
  const expected = createHmac("sha256", decodeWebhookSecret(secret)).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
  const candidates = signatureHeader.split(" ").map((value) => value.startsWith("v1,") ? value.slice(3) : "").filter(Boolean);
  return candidates.some((candidate) => {
    const left = Buffer.from(expected, "utf8");
    const right = Buffer.from(candidate, "utf8");
    return left.length === right.length && timingSafeEqual(left, right);
  });
}
