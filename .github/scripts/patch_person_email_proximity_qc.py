from pathlib import Path

path = Path("lib/connect-public-research.ts")
s = path.read_text()

old = '''  "admin", "billing", "careers", "contact", "hello", "hr", "info", "jobs", "marketing",
  "office", "sales", "service", "support", "team"
'''
new = '''  "admin", "billing", "careers", "contact", "hello", "hr", "info", "jobs", "marketing",
  "office", "sales", "service", "support", "team", "workorder", "placeservicecall", "customerservice",
  "customercare", "firealarm", "voe"
'''
if old not in s:
    raise SystemExit("generic email locals anchor not found")
s = s.replace(old, new, 1)

old_pattern = '''        const pattern = deriveEmailPattern(candidate, normalizedEmail, domain);
        if (!pattern) continue;
'''
new_pattern = '''        const pattern = deriveEmailPattern(candidate, normalizedEmail, domain);
        // A first-name-only address cannot validate the surname, so free-text
        // proximity alone is insufficient. FIRST is handled separately using
        // visible line/card boundaries below.
        if (!pattern || pattern === "FIRST") continue;
'''
if old_pattern not in s:
    raise SystemExit("nearby pattern anchor not found")
s = s.replace(old_pattern, new_pattern, 1)

anchor = '''function publicEmployeeEmailObservations(pages: PageSnapshot[], domain: string) {
'''
helper = r'''function lineBoundPersonNameForFirstEmail(text: string, email: string, domain: string) {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const normalizedEmail = email.trim().toLowerCase();

  const leadingNames = (value: string) => {
    const beforeSeparator = value.split(/\s*[|/–—:]\s*/)[0]?.trim() ?? "";
    const tokens = [...beforeSeparator.matchAll(/\b[A-Z][A-Za-z'’.-]*\b/g)].map((match) => match[0]);
    const candidates: string[] = [];
    for (const length of [2, 3]) {
      if (tokens.length < length) continue;
      candidates.push(cleanName(tokens.slice(0, length).join(" ")));
    }
    return candidates;
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const emailIndex = line.toLowerCase().indexOf(normalizedEmail);
    if (emailIndex < 0) continue;

    const fragments: string[] = [];
    const sameLineBefore = line.slice(0, emailIndex).trim();
    if (sameLineBefore) fragments.push(sameLineBefore);
    for (let offset = 1; offset <= 2; offset++) {
      const previous = lines[index - offset];
      if (previous) fragments.push(previous);
    }

    for (const fragment of fragments) {
      for (const candidate of leadingNames(fragment)) {
        if (!looksLikePersonName(candidate) || !emailLooksLikeName(normalizedEmail, candidate)) continue;
        const pattern = deriveEmailPattern(candidate, normalizedEmail, domain);
        if (pattern === "FIRST") return { name: candidate, pattern };
      }
    }
  }
  return null;
}

function publicEmployeeEmailObservations(pages: PageSnapshot[], domain: string) {
'''
if anchor not in s:
    raise SystemExit("observation function anchor not found")
s = s.replace(anchor, helper, 1)

old_loop = '''    for (const email of personalEmails(extractEmails(page.html, domain))) {
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
new_loop = '''    for (const email of personalEmails(extractEmails(page.html, domain))) {
      const lineBound = lineBoundPersonNameForFirstEmail(page.text, email, domain);
      if (lineBound) {
        remember({
          name: lineBound.name,
          email,
          pattern: lineBound.pattern,
          sourceUrl: page.url,
          sourceKind: page.sourceKind,
          binding: "TEXT_NAME_EMAIL_PROXIMITY",
          confidence: 88
        });
      }

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
if old_loop not in s:
    raise SystemExit("observation loop anchor not found")
s = s.replace(old_loop, new_loop, 1)

path.write_text(s)
