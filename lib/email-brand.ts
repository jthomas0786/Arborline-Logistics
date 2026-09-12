export type EmailFact = { label: string; value: string };

export type BrandedEmailInput = {
  baseUrl: string;
  eyebrow: string;
  title: string;
  intro: string;
  actionUrl?: string | null;
  actionLabel?: string | null;
  facts?: EmailFact[];
  note?: string | null;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function renderBrandedEmail(input: BrandedEmailInput) {
  const baseUrl = safeUrl(input.baseUrl).replace(/\/$/, "");
  const logoUrl = baseUrl ? `${baseUrl}/brand/arborline-logo.png` : "";
  const actionUrl = input.actionUrl ? safeUrl(input.actionUrl) : "";
  const facts = (input.facts ?? []).filter((fact) => fact.label && fact.value);

  const factRows = facts.map((fact) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e6edf7;color:#617b9b;font-family:Arial,sans-serif;font-size:12px;line-height:18px;width:36%;">${escapeHtml(fact.label)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e6edf7;color:#10213d;font-family:Arial,sans-serif;font-size:13px;line-height:18px;font-weight:700;">${escapeHtml(fact.value)}</td>
    </tr>`).join("");

  const action = actionUrl && input.actionLabel ? `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 8px;">
      <tr><td bgcolor="#2d7fff" style="border-radius:8px;">
        <a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:13px 20px;color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-size:14px;line-height:18px;font-weight:700;">${escapeHtml(input.actionLabel)}</a>
      </td></tr>
    </table>` : "";

  const note = input.note ? `<p style="margin:18px 0 0;color:#617b9b;font-family:Arial,sans-serif;font-size:12px;line-height:19px;">${escapeHtml(input.note)}</p>` : "";
  const website = baseUrl ? `<a href="${escapeHtml(baseUrl)}" style="color:#2d7fff;text-decoration:none;">${escapeHtml(baseUrl.replace(/^https?:\/\//, ""))}</a>` : "ArborLine Logistics";

  return `<!doctype html>
<html lang="en">
  <head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head>
  <body style="margin:0;padding:0;background:#f3f6fb;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(input.title)} — ArborLine Logistics</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f3f6fb" style="width:100%;background:#f3f6fb;">
      <tr><td align="center" style="padding:28px 14px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #dce6f3;border-radius:14px;overflow:hidden;box-shadow:0 8px 28px rgba(5,13,28,.07);">
          <tr><td style="height:5px;background:#2d7fff;font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr><td style="padding:24px 30px 20px;background:#ffffff;border-bottom:1px solid #e6edf7;">
            ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" width="245" alt="ArborLine Logistics" style="display:block;width:245px;max-width:100%;height:auto;border:0;">` : `<div style="font-family:Arial,sans-serif;font-size:24px;font-weight:800;color:#071326;">Arbor<span style="color:#2d7fff;">Line</span> Logistics</div>`}
          </td></tr>
          <tr><td style="padding:30px;">
            <div style="margin:0 0 8px;color:#2d7fff;font-family:Arial,sans-serif;font-size:11px;line-height:16px;font-weight:800;letter-spacing:1.7px;text-transform:uppercase;">${escapeHtml(input.eyebrow)}</div>
            <h1 style="margin:0 0 14px;color:#071326;font-family:Arial,sans-serif;font-size:28px;line-height:34px;letter-spacing:-.4px;">${escapeHtml(input.title)}</h1>
            <p style="margin:0;color:#435c7a;font-family:Arial,sans-serif;font-size:15px;line-height:24px;">${escapeHtml(input.intro)}</p>
            ${facts.length ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:22px 0 0;border:1px solid #e6edf7;border-radius:9px;border-collapse:separate;overflow:hidden;">${factRows}</table>` : ""}
            ${action}
            ${note}
          </td></tr>
          <tr><td style="padding:20px 30px 24px;background:#071326;border-top:4px solid #f59e0b;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td valign="top" style="color:#f7fbff;font-family:Arial,sans-serif;font-size:13px;line-height:20px;font-weight:700;">ArborLine Logistics Operations<br><span style="color:#8faed3;font-size:11px;font-weight:400;">Automated freight brokerage</span></td>
                <td valign="top" align="right" style="color:#8faed3;font-family:Arial,sans-serif;font-size:11px;line-height:18px;">${website}</td>
              </tr>
            </table>
          </td></tr>
        </table>
        <p style="margin:14px 0 0;color:#879bb4;font-family:Arial,sans-serif;font-size:10px;line-height:16px;">This operational message was generated by ArborLine Logistics.</p>
      </td></tr>
    </table>
  </body>
</html>`;
}
