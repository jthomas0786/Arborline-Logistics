from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing marker: {label}")
    return text.replace(old, new, 1)


# Shared unsubscribe helper in scheduled sender.
path = Path("lib/connect-outreach-send.ts")
text = path.read_text()
text = replace_once(text, 'import { createHmac } from "crypto";\n', '', "sender crypto import")
text = replace_once(
    text,
    'import { CONNECT_REPLY_TO } from "@/lib/connect-reply-routing";\n',
    'import { CONNECT_REPLY_TO } from "@/lib/connect-reply-routing";\nimport { createConnectUnsubscribeToken, getConnectUnsubscribeSigningSecret } from "@/lib/connect-unsubscribe";\n',
    "sender unsubscribe import",
)
old_helpers = '''function unsubscribeToken(messageId: string, secret: string) {
  const payload = Buffer.from(messageId, "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function unsubscribeSigningSecret() {
  const explicit = process.env.CONNECT_UNSUBSCRIBE_SECRET?.trim() || "";
  if (explicit) return explicit;
  const cronSecret = process.env.CRON_SECRET?.trim() || "";
  if (!cronSecret) return "";
  return createHmac("sha256", cronSecret)
    .update("arborline-connect-unsubscribe-signing-v1")
    .digest("hex");
}

'''
text = replace_once(text, old_helpers, '', "sender local unsubscribe helpers")
text = replace_once(text, 'const unsubscribeSecret = unsubscribeSigningSecret();', 'const unsubscribeSecret = getConnectUnsubscribeSigningSecret();', "sender signing secret")
text = replace_once(text, 'const token = unsubscribeToken(messageId, config.unsubscribeSecret);', 'const token = createConnectUnsubscribeToken(messageId, config.unsubscribeSecret);', "sender token creation")
path.write_text(text)


# Public verifier uses the exact same explicit-or-derived signing secret and token parser.
path = Path("app/api/public/connect-unsubscribe/[token]/route.ts")
text = path.read_text()
text = replace_once(text, 'import { createHmac, timingSafeEqual } from "crypto";\n', '', "unsubscribe route crypto import")
text = replace_once(
    text,
    'import { getPool } from "@/lib/db";\n',
    'import { getPool } from "@/lib/db";\nimport { getConnectUnsubscribeSigningSecret, verifyConnectUnsubscribeToken } from "@/lib/connect-unsubscribe";\n',
    "unsubscribe route helper import",
)
old_decode = '''function decodeToken(token: string, secret: string) {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const left = Buffer.from(expected); const right = Buffer.from(signature);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try { return Buffer.from(payload, "base64url").toString("utf8"); } catch { return null; }
}

'''
text = replace_once(text, old_decode, '', "unsubscribe route local decoder")
text = replace_once(text, 'const secret = process.env.CONNECT_UNSUBSCRIBE_SECRET?.trim();', 'const secret = getConnectUnsubscribeSigningSecret();', "unsubscribe route signing secret")
text = replace_once(text, 'const messageId = decodeToken(token, secret);', 'const messageId = verifyConnectUnsubscribeToken(token, secret);', "unsubscribe route verifier")
path.write_text(text)


# Manual campaign path uses the shared helper and the same safety/compliance gates as scheduled sending.
path = Path("app/campaigns/actions.ts")
text = path.read_text()
text = replace_once(text, 'import { createHmac } from "crypto";\n', '', "actions crypto import")
text = replace_once(
    text,
    'import { CONNECT_REPLY_TO } from "@/lib/connect-reply-routing";\n',
    'import { CONNECT_REPLY_TO } from "@/lib/connect-reply-routing";\nimport { createConnectUnsubscribeToken, getConnectUnsubscribeSigningSecret } from "@/lib/connect-unsubscribe";\n',
    "actions unsubscribe import",
)
text = replace_once(text, 'const unsubscribeSecret = process.env.CONNECT_UNSUBSCRIBE_SECRET?.trim() || "";', 'const unsubscribeSecret = getConnectUnsubscribeSigningSecret();', "actions signing secret")
old_token = '''function unsubscribeToken(messageId: string, secret: string) {
  const payload = Buffer.from(messageId, "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

'''
text = replace_once(text, old_token, '', "actions local token helper")
text = replace_once(
    text,
    "AND p.qualification_status='QUALIFIED' AND p.outreach_status IN ('READY','QUEUED')",
    "AND p.qualification_status='QUALIFIED' AND (p.source <> 'ARBORLINE_DISCOVERY' OR p.source_metadata->'service_fit'->>'status'='MATCH') AND p.outreach_status IN ('READY','QUEUED')",
    "actions approval service-fit gate",
)
text = replace_once(
    text,
    "WHERE m.id=$1 AND m.status='QUEUED' AND p.qualification_status='QUALIFIED' AND p.outreach_status='QUEUED'",
    "WHERE m.id=$1 AND m.status='QUEUED' AND p.qualification_status='QUALIFIED' AND (p.source <> 'ARBORLINE_DISCOVERY' OR p.source_metadata->'service_fit'->>'status'='MATCH') AND p.outreach_status='QUEUED'",
    "actions live load service-fit gate",
)
text = replace_once(
    text,
    "WHERE p.client_id=$1 AND p.qualification_status='QUALIFIED' AND p.outreach_status='READY'",
    "WHERE p.client_id=$1 AND p.qualification_status='QUALIFIED' AND (p.source <> 'ARBORLINE_DISCOVERY' OR p.source_metadata->'service_fit'->>'status'='MATCH') AND p.outreach_status='READY'",
    "actions draft service-fit gate",
)
text = replace_once(
    text,
    "sent_at >= date_trunc('day', now())",
    "sent_at >= (date_trunc('day', now() AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago')",
    "actions Chicago daily limit",
)
text = replace_once(text, 'const token=unsubscribeToken(String(message.id),config.unsubscribeSecret);', 'const token=createConnectUnsubscribeToken(String(message.id),config.unsubscribeSecret);', "actions token creation")
text = replace_once(
    text,
    "SET provider_message_id=$2,status='SENT',sent_at=now(),sender_name='Josh Thomas'",
    "SET provider='RESEND',provider_message_id=$2,status='SENT',sent_at=now(),sender_name='Josh Thomas'",
    "actions provider persistence",
)
path.write_text(text)
