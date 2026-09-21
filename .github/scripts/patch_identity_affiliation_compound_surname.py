from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"anchor not found in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))

public = "lib/connect-public-research.ts"

replace_once(
    public,
    '''function emailLooksLikeName(email: string, name: string) {\n  const local = normalizeNameToken(email.split("@")[0] ?? "");\n  const parts = name.split(/\\s+/)\n    .map(normalizeNameToken)\n    .filter((part) => part && !HONORIFICS.has(part) && !NAME_SUFFIXES.has(part));\n  if (parts.length < 2 || !local) return false;\n  const first = parts[0];\n  const last = parts[parts.length - 1];\n''',
    '''function emailNameParts(name: string) {\n  const parts = name.split(/\\s+/)\n    .map(normalizeNameToken)\n    .filter((part) => part && !HONORIFICS.has(part) && !NAME_SUFFIXES.has(part));\n  if (parts.length < 2) return null;\n  const givenCandidates = parts.slice(0, -1).filter((part) => !NAME_PARTICLES.has(part));\n  const first = givenCandidates.find((part) => part.length > 1) ?? givenCandidates[0] ?? parts[0];\n  let surnameStart = parts.length - 1;\n  while (surnameStart > 0 && NAME_PARTICLES.has(parts[surnameStart - 1])) surnameStart--;\n  const last = parts.slice(surnameStart).join("");\n  if (!first || !last || first === last) return null;\n  return { first, last };\n}\n\nfunction emailLooksLikeName(email: string, name: string) {\n  const local = normalizeNameToken(email.split("@")[0] ?? "");\n  const parts = emailNameParts(name);\n  if (!parts || !local) return false;\n  const { first, last } = parts;\n'''
)

replace_once(
    public,
    '''function deriveEmailPattern(name: string, email: string, domain: string): PublicEmailPattern | null {\n  if (!hostAllowed(email.split("@")[1] ?? "", domain)) return null;\n  const parts = name.split(/\\s+/)\n    .map(normalizeNameToken)\n    .filter((part) => part && !HONORIFICS.has(part) && !NAME_SUFFIXES.has(part));\n  if (parts.length < 2) return null;\n  const first = parts[0];\n  const last = parts[parts.length - 1];\n  if (!first || !last) return null;\n''',
    '''function deriveEmailPattern(name: string, email: string, domain: string): PublicEmailPattern | null {\n  if (!hostAllowed(email.split("@")[1] ?? "", domain)) return null;\n  const parts = emailNameParts(name);\n  if (!parts) return null;\n  const { first, last } = parts;\n'''
)

replace_once(
    public,
    '''function inferredEmails(name: string | null, domain: string) {\n  if (!name) return [];\n  const parts = name.split(/\\s+/)\n    .map(normalizeNameToken)\n    .filter((part) => part && !HONORIFICS.has(part) && !NAME_SUFFIXES.has(part));\n  if (parts.length < 2) return [];\n  const first = parts[0];\n  const last = parts[parts.length - 1];\n  if (!first || !last) return [];\n''',
    '''function inferredEmails(name: string | null, domain: string) {\n  if (!name) return [];\n  const parts = emailNameParts(name);\n  if (!parts) return [];\n  const { first, last } = parts;\n'''
)

replace_once(
    public,
    '''function escapeRegex(value: string) {\n  return value.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");\n}\n\nfunction candidateFromPages(pages: PageSnapshot[], domain: string, approvedTitles: string[]): PublicResearchCandidate | null {\n''',
    '''function escapeRegex(value: string) {\n  return value.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");\n}\n\nfunction titleHasExternalAffiliation(value: string, domain: string) {\n  const match = value.match(/\\bof\\s+(?:the\\s+)?([A-Za-z0-9&.'’ -]{3,100})/i);\n  if (!match) return false;\n  const affiliation = normalizeNameToken(match[1] ?? "");\n  const brand = normalizeNameToken(normalizeDomain(domain).split(".")[0] ?? "");\n  if (!affiliation || !brand) return false;\n  return !affiliation.includes(brand) && !brand.includes(affiliation);\n}\n\nfunction candidateFromPages(pages: PageSnapshot[], domain: string, approvedTitles: string[]): PublicResearchCandidate | null {\n'''
)

replace_once(
    public,
    '''      const matchedTitle = titleMatches(line, approvedTitles);\n      if (!matchedTitle) continue;\n\n      const normalizedMatchedTitle = normalizeTitle(matchedTitle);\n''',
    '''      const matchedTitle = titleMatches(line, approvedTitles);\n      if (!matchedTitle) continue;\n      if (titleHasExternalAffiliation(line, domain)) continue;\n\n      const normalizedMatchedTitle = normalizeTitle(matchedTitle);\n'''
)

replace_once(
    public,
    '''      const matchedTitle = titleMatches(rawTitle, approvedTitles);\n      if (!matchedTitle) continue;\n\n      const rawEmail = String(obj.email ?? "").trim().replace(/^mailto:/i, "").toLowerCase();\n''',
    '''      const matchedTitle = titleMatches(rawTitle, approvedTitles);\n      if (!matchedTitle) continue;\n      if (titleHasExternalAffiliation(rawTitle, domain)) continue;\n\n      const rawEmail = String(obj.email ?? "").trim().replace(/^mailto:/i, "").toLowerCase();\n'''
)

native = "lib/connect-native-enrichment.ts"
replace_once(
    native,
    '''const NAME_HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "professor", "sir", "madam"]);\nconst NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);\n''',
    '''const NAME_HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "professor", "sir", "madam"]);\nconst NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);\nconst NAME_PARTICLES = new Set(["al", "bin", "da", "de", "del", "della", "der", "di", "du", "la", "le", "van", "von"]);\n'''
)

replace_once(
    native,
    '''function nameParts(value: string | null | undefined) {\n  const parts = (value ?? "")\n    .trim()\n    .split(/\\s+/)\n    .map(normalizeNamePart)\n    .filter((part) => part && !NAME_HONORIFICS.has(part) && !NAME_SUFFIXES.has(part));\n  if (parts.length < 2) return null;\n  return { first: parts[0], last: parts[parts.length - 1] };\n}\n''',
    '''function nameParts(value: string | null | undefined) {\n  const parts = (value ?? "")\n    .trim()\n    .split(/\\s+/)\n    .map(normalizeNamePart)\n    .filter((part) => part && !NAME_HONORIFICS.has(part) && !NAME_SUFFIXES.has(part));\n  if (parts.length < 2) return null;\n  const givenCandidates = parts.slice(0, -1).filter((part) => !NAME_PARTICLES.has(part));\n  const first = givenCandidates.find((part) => part.length > 1) ?? givenCandidates[0] ?? parts[0];\n  let surnameStart = parts.length - 1;\n  while (surnameStart > 0 && NAME_PARTICLES.has(parts[surnameStart - 1])) surnameStart--;\n  const last = parts.slice(surnameStart).join("");\n  if (!first || !last || first === last) return null;\n  return { first, last };\n}\n'''
)
