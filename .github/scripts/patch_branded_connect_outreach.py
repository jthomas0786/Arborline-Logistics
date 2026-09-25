from pathlib import Path

path = Path("lib/connect-outreach-send.ts")
text = path.read_text()

base_anchor = '''function baseUrl() {
  return (process.env.APP_BASE_URL || "https://www.arborlineconnect.com").replace(/\\/$/, "");
}
'''

helpers = r'''function baseUrl() {
  return (process.env.APP_BASE_URL || "https://www.arborlineconnect.com").replace(/\/$/, "");
}

function stripLegacyConnectSignature(value: string) {
  return value
    .trimEnd()
    .replace(/\n{2,}Best,[ \t]*\nJosh(?: Thomas)?(?:[ \t]*\nArborLine Connect)?[ \t]*$/i, "")
    .trimEnd();
}

function connectSignatureText() {
  const website = baseUrl().replace(/^https?:\/\//, "");
  return `Best,\nJosh Thomas\nFounder, ArborLine Connect\n${CONNECT_FROM_EMAIL}\n${website}`;
}

function connectSignatureHtml() {
  const site = baseUrl();
  const logoUrl = `${site}/brand/arborline-logo.png`;
  const website = site.replace(/^https?:\/\//, "");
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:24px"><tr><td style="font-family:Arial,sans-serif;color:#122033;line-height:1.45"><div style="font-size:14px;margin-bottom:8px">Best,</div><div style="font-size:16px;font-weight:700;color:#071326">Josh Thomas</div><div style="font-size:13px;color:#52657d">Founder, ArborLine Connect</div><div style="font-size:12px;margin-top:4px"><a href="mailto:${CONNECT_FROM_EMAIL}" style="color:#2d7fff;text-decoration:none">${CONNECT_FROM_EMAIL}</a><span style="color:#a2afbf"> &nbsp;|&nbsp; </span><a href="${escapeHtml(site)}" style="color:#2d7fff;text-decoration:none">${escapeHtml(website)}</a></div><div style="margin-top:12px"><a href="${escapeHtml(site)}" style="text-decoration:none"><img src="${escapeHtml(logoUrl)}" width="180" alt="ArborLine Connect" style="display:block;width:180px;max-width:100%;height:auto;border:0" /></a></div></td></tr></table>`;
}
'''

if base_anchor not in text:
    raise SystemExit("baseUrl anchor not found")
text = text.replace(base_anchor, helpers, 1)

old_block = '''    const token = createConnectUnsubscribeToken(messageId, config.unsubscribeSecret);
    const unsubscribeUrl = `${baseUrl()}/api/public/connect-unsubscribe/${token}`;
    const body = `${message.body_text}\\n\\nArborLine Connect\\n${config.postalAddress}\\nUnsubscribe: ${unsubscribeUrl}`;
    const htmlBody = connectTextToHtml(String(message.body_text));
    const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#122033;line-height:1.6">${htmlBody}<hr style="border:0;border-top:1px solid #dbe3ee;margin:28px 0 16px"/><div style="font-size:12px;color:#637083">ArborLine Connect<br/>${escapeHtml(config.postalAddress)}<br/><a href="${unsubscribeUrl}">Unsubscribe</a></div></div>`;
'''

new_block = '''    const token = createConnectUnsubscribeToken(messageId, config.unsubscribeSecret);
    const unsubscribeUrl = `${baseUrl()}/api/public/connect-unsubscribe/${token}`;
    const messageBodyText = stripLegacyConnectSignature(String(message.body_text));
    const body = `${messageBodyText}\\n\\n${connectSignatureText()}\\n\\nArborLine Connect\\n${config.postalAddress}\\nUnsubscribe: ${unsubscribeUrl}`;
    const htmlBody = connectTextToHtml(messageBodyText);
    const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#122033;line-height:1.6">${htmlBody}${connectSignatureHtml()}<hr style="border:0;border-top:1px solid #dbe3ee;margin:28px 0 16px"/><div style="font-size:12px;color:#637083">ArborLine Connect<br/>${escapeHtml(config.postalAddress)}<br/><a href="${unsubscribeUrl}">Unsubscribe</a></div></div>`;
'''

if old_block not in text:
    raise SystemExit("outreach render block not found")
text = text.replace(old_block, new_block, 1)

path.write_text(text)
print("Patched branded ArborLine outreach signature and logo.")
