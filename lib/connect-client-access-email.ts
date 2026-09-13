import { renderBrandedEmail } from "./email-brand";

const FROM = "Josh Thomas <josh@mail.arborlineconnect.com>";
const REPLY_TO = "josh@mail.arborlineconnect.com";

function baseUrl() {
  return (process.env.APP_BASE_URL || "https://www.arborlineconnect.com").replace(/\/$/, "");
}

export async function sendConnectClientPortalWelcome(input: {
  inviteId: string;
  email: string;
  companyName: string;
  contactName?: string | null;
}) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error("Resend is not configured for client portal access.");

  const url = `${baseUrl()}/client-access`;
  const firstName = String(input.contactName || "there").trim().split(/\s+/)[0] || "there";
  const subject = "Your ArborLine Connect client portal is ready";
  const text = `Hi ${firstName},\n\nYour ArborLine Connect client portal for ${input.companyName} is ready.\n\nOpen ${url} and enter this invited work email: ${input.email}\n\nArborLine will email you a secure sign-in link. No password is required.\n\nInside the portal you can review qualified opportunities, prospect replies, appointments, targeting, and billing.\n\nBest,\nJosh Thomas\nFounder, ArborLine Connect`;
  const html = renderBrandedEmail({
    baseUrl: baseUrl(),
    eyebrow: "CLIENT PORTAL",
    title: "Your ArborLine portal is ready",
    intro: `Your secure client portal for ${input.companyName} is ready. Use your invited work email to request a sign-in link—no password required.`,
    actionUrl: url,
    actionLabel: "Open client portal",
    facts: [
      { label: "Invited email", value: input.email },
      { label: "Opportunities", value: "Qualified companies and decision-makers" },
      { label: "Conversations", value: "Matched prospect replies and next steps" },
      { label: "Account", value: "Targeting, appointments, and billing" }
    ],
    note: "For security, the portal will email a fresh sign-in link whenever you need access."
  });

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `connect-client-portal-${input.inviteId}`
    },
    body: JSON.stringify({
      from: FROM,
      reply_to: REPLY_TO,
      to: [input.email],
      subject,
      text,
      html
    })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(`Client portal welcome email failed (${response.status}): ${String(data.message || "unknown error")}`);
  }
}
