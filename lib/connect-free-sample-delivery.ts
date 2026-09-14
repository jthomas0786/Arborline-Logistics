import { CONNECT_REPLY_TO } from "@/lib/connect-reply-routing";

const SAMPLE_FROM = "Josh Thomas <josh@mail.arborlineconnect.com>";

export type FreeSampleDeliveryRequest = {
  id: string;
  name: string;
  work_email: string;
  company_name: string;
  target_customer?: string | null;
  service_area?: string | null;
  decision_maker_titles?: string | null;
  sample_share_token?: string | null;
};

export type FreeSampleDeliveryMatch = {
  company_name: string;
  industry?: string | null;
  city?: string | null;
  state?: string | null;
  match_score?: number | null;
};

function baseUrl() {
  return (process.env.APP_BASE_URL || "https://www.arborlineconnect.com").replace(/\/$/, "");
}

export function sampleShareUrl(token: string) {
  return `${baseUrl()}/sample/view/${encodeURIComponent(token)}`;
}

export function sampleDeliveryEnabled() {
  return process.env.CONNECT_SAMPLE_DELIVERY_ENABLED === "true";
}

export function sampleDeliveryConfigured() {
  return {
    enabled: sampleDeliveryEnabled(),
    resend: Boolean(process.env.RESEND_API_KEY?.trim()),
    ready: sampleDeliveryEnabled() && Boolean(process.env.RESEND_API_KEY?.trim())
  };
}

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || "there";
}

export function buildFreeSampleEmailDraft(
  request: FreeSampleDeliveryRequest,
  matches: FreeSampleDeliveryMatch[],
  shareToken: string
) {
  const url = sampleShareUrl(shareToken);
  const geography = request.service_area?.trim() || "your requested market";
  const target = request.target_customer?.trim() || "your ideal customer profile";
  const decisionMakers = request.decision_maker_titles?.trim();
  const matchLines = matches.slice(0, 5).map((match, index) => {
    const location = [match.city, match.state].filter(Boolean).join(", ");
    const details = [match.industry, location, match.match_score != null ? `${match.match_score}/100 fit` : null].filter(Boolean).join(" · ");
    return `${index + 1}. ${match.company_name}${details ? ` — ${details}` : ""}`;
  });

  const subject = `Your ArborLine prospect sample for ${request.company_name}`;
  const body = [
    `Hi ${firstName(request.name)},`,
    "",
    `I put together your free ArborLine prospect sample based on the target profile you submitted for ${request.company_name}.`,
    "",
    `Target: ${target}`,
    `Geography: ${geography}`,
    decisionMakers ? `Decision makers: ${decisionMakers}` : null,
    "",
    `I selected ${matches.length} companies that look like strong fits:`,
    ...matchLines,
    "",
    `View the full branded sample here: ${url}`,
    "",
    "This is a small preview of how ArborLine Connect can continuously find and qualify businesses around your ideal customer profile. If the matches look right, reply to this email and I can walk you through the Founding Client setup.",
    "",
    "Josh Thomas",
    "ArborLine Connect"
  ].filter((line): line is string => line !== null).join("\n");

  return { subject, body, url };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char] || char));
}

export async function sendFreeSampleDelivery(input: {
  requestId: string;
  recipient: string;
  subject: string;
  body: string;
  shareToken: string;
}) {
  if (!sampleDeliveryEnabled()) throw new Error("SAMPLE_DELIVERY_DISABLED");
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error("SAMPLE_RESEND_NOT_CONFIGURED");

  const url = sampleShareUrl(input.shareToken);
  const text = input.body.includes(url) ? input.body : `${input.body}\n\nView your sample: ${url}`;
  const htmlBody = escapeHtml(input.body).replace(/\n/g, "<br />");
  const html = `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#122033;line-height:1.6"><div style="margin-bottom:18px"><strong style="font-size:18px">ArborLine Connect</strong></div><div>${htmlBody}</div><div style="margin:28px 0"><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 18px;border-radius:9px;background:#2d7fff;color:#fff;text-decoration:none;font-weight:700">View your prospect sample</a></div><div style="font-size:12px;color:#637083">You requested this free prospect sample at ArborLine Connect. Reply directly to this email if you want to refine the target profile or discuss Founding Client setup.</div></div>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `connect-sample-${input.requestId}`
    },
    body: JSON.stringify({
      from: SAMPLE_FROM,
      reply_to: CONNECT_REPLY_TO,
      to: [input.recipient],
      subject: input.subject,
      text,
      html
    })
  });

  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Resend failed (${response.status}): ${String(result.message || "unknown error")}`);
  const providerId = String(result.id || "");
  if (!providerId) throw new Error("Resend accepted the sample email without returning an id.");
  return providerId;
}
