import { createHmac, timingSafeEqual } from "crypto";
import { getPool } from "@/lib/db";

function decodeToken(token: string, secret: string) {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const left = Buffer.from(expected); const right = Buffer.from(signature);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try { return Buffer.from(payload, "base64url").toString("utf8"); } catch { return null; }
}

function page(title: string, message: string, status = 200) {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:Arial,sans-serif;background:#071426;color:#fff;padding:48px"><main style="max-width:640px;margin:auto;background:#0c2038;border:1px solid #1d5a9f;border-radius:16px;padding:28px"><h1>${title}</h1><p style="color:#b8d2ef;line-height:1.6">${message}</p></main></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

async function unsubscribe(token: string) {
  const secret = process.env.CONNECT_UNSUBSCRIBE_SECRET?.trim();
  if (!secret) return page("Unsubscribe unavailable", "This unsubscribe endpoint is not configured yet.", 503);
  const messageId = decodeToken(token, secret);
  if (!messageId) return page("Invalid unsubscribe link", "This unsubscribe link is invalid or has been altered.", 400);
  const pool = getPool();
  const { rows } = await pool.query(`SELECT m.id,m.prospect_id,m.client_id,m.recipient_email FROM connect_outreach_messages m WHERE m.id=$1 LIMIT 1`, [messageId]);
  const message = rows[0];
  if (!message) return page("Unsubscribe link expired", "We could not find this outreach record.", 404);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // A recipient who opts out of ArborLine outreach is suppressed platform-wide so
    // another client campaign cannot accidentally reintroduce the same address.
    await client.query(`INSERT INTO connect_suppressions (client_id,email,reason,source) VALUES (NULL,$1,'UNSUBSCRIBED','PUBLIC_UNSUBSCRIBE') ON CONFLICT DO NOTHING`, [message.recipient_email]);
    await client.query(`UPDATE connect_prospects SET suppression_status='UNSUBSCRIBED',qualification_status='SUPPRESSED',outreach_status='STOPPED',updated_at=now() WHERE contact_email IS NOT NULL AND lower(contact_email)=lower($1)`, [message.recipient_email]);
    await client.query(`UPDATE connect_outreach_messages SET status=CASE WHEN status='QUEUED' THEN 'CANCELLED' ELSE status END,updated_at=now() WHERE recipient_email IS NOT NULL AND lower(recipient_email)=lower($1) AND status IN ('DRAFT','QUEUED')`, [message.recipient_email]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    return page("Unable to unsubscribe", "We could not process this request. Please reply to the email and ask to be removed.", 500);
  } finally { client.release(); }
  return page("You’re unsubscribed", "You will not receive further ArborLine Connect outreach. Your address has been added to the suppression list.");
}

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) { const { token } = await params; return unsubscribe(token); }
export async function POST(_: Request, { params }: { params: Promise<{ token: string }> }) { const { token } = await params; return unsubscribe(token); }
