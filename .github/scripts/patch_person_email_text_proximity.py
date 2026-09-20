from pathlib import Path

path = Path("lib/connect-public-research.ts")
s = path.read_text()

old = '  binding: "STRUCTURED_PERSON" | "MAILTO_PERSON_ANCHOR";\n'
new = '  binding: "STRUCTURED_PERSON" | "MAILTO_PERSON_ANCHOR" | "TEXT_NAME_EMAIL_PROXIMITY";\n'
if old not in s:
    raise SystemExit("binding union anchor not found")
s = s.replace(old, new, 1)

anchor = '''function publicEmployeeEmailObservations(pages: PageSnapshot[], domain: string) {
'''
helper = r'''function nearbyPersonNameForEmail(text: string, email: string, domain: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const lowerText = text.toLowerCase();
  let searchFrom = 0;
  let best: { name: string; pattern: PublicEmailPattern; distance: number } | null = null;

  while (searchFrom < lowerText.length) {
    const emailIndex = lowerText.indexOf(normalizedEmail, searchFrom);
    if (emailIndex < 0) break;
    const windowStart = Math.max(0, emailIndex - 700);
    const before = text.slice(windowStart, emailIndex);
    const tokens = [...before.matchAll(/\b[A-Z][A-Za-z'’.-]*\b/g)]
      .filter((match) => Boolean(match[0]))
      .slice(-80);

    for (let end = tokens.length - 1; end >= 1; end--) {
      for (let length = 2; length <= 4; length++) {
        const start = end - length + 1;
        if (start < 0) continue;
        const candidate = cleanName(tokens.slice(start, end + 1).map((match) => match[0]).join(" "));
        if (!looksLikePersonName(candidate) || !emailLooksLikeName(normalizedEmail, candidate)) continue;
        const pattern = deriveEmailPattern(candidate, normalizedEmail, domain);
        if (!pattern) continue;
        const tokenStart = tokens[start].index ?? before.length;
        const distance = before.length - tokenStart;
        if (distance > 700) continue;
        if (!best || distance < best.distance) best = { name: candidate, pattern, distance };
      }
    }
    searchFrom = emailIndex + normalizedEmail.length;
  }
  return best;
}

function publicEmployeeEmailObservations(pages: PageSnapshot[], domain: string) {
'''
if anchor not in s:
    raise SystemExit("observation function anchor not found")
s = s.replace(anchor, helper, 1)

old_loop_end = '''    for (const match of page.html.matchAll(/<a\\b[^>]*href\\s*=\\s*["']mailto:([^"'?]+)(?:\\?[^"']*)?["'][^>]*>([\\s\\S]{0,240}?)<\\/a>/gi)) {
      const email = decodeHtml(match[1] ?? "").trim().toLowerCase();
      const name = cleanName(htmlToText(match[2] ?? ""));
      if (!email || !looksLikePersonName(name) || !emailLooksLikeName(email, name)) continue;
      const pattern = deriveEmailPattern(name, email, domain);
      if (!pattern) continue;
      remember({
        name,
        email,
        pattern,
        sourceUrl: page.url,
        sourceKind: page.sourceKind,
        binding: "MAILTO_PERSON_ANCHOR",
        confidence: 88
      });
    }
'''
new_loop_end = old_loop_end + '''
    for (const email of personalEmails(extractEmails(page.html, domain))) {
      const nearby = nearbyPersonNameForEmail(page.text, email, domain);
      if (!nearby) continue;
      remember({
        name: nearby.name,
        email,
        pattern: nearby.pattern,
        sourceUrl: page.url,
        sourceKind: page.sourceKind,
        binding: "TEXT_NAME_EMAIL_PROXIMITY",
        confidence: nearby.distance <= 260 ? 88 : 84
      });
    }
'''
if old_loop_end not in s:
    raise SystemExit("mailto loop anchor not found")
s = s.replace(old_loop_end, new_loop_end, 1)

path.write_text(s)
