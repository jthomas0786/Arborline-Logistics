from pathlib import Path

p = Path('lib/connect-public-research.ts')
text = p.read_text()
old = '''      const line = lines[index];\n      const matchedTitle = titleMatches(line, approvedTitles);\n      if (!matchedTitle) continue;\n      if (titleHasExternalAffiliation(line, domain)) continue;\n\n      const normalizedMatchedTitle = normalizeTitle(matchedTitle);\n      const exactTitlePattern = new RegExp(escapeRegex(matchedTitle), "i");\n      const exactTitleIndex = line.search(exactTitlePattern);'''
new = '''      const line = lines[index];\n      const matchedTitle = titleMatches(line, approvedTitles);\n      if (!matchedTitle) continue;\n\n      const normalizedMatchedTitle = normalizeTitle(matchedTitle);\n      const exactTitlePattern = new RegExp(escapeRegex(matchedTitle), "i");\n      const exactTitleIndex = line.search(exactTitlePattern);\n      const affiliationWindow = exactTitleIndex >= 0\n        ? line.slice(Math.max(0, exactTitleIndex - 60), Math.min(line.length, exactTitleIndex + matchedTitle.length + 140))\n        : line;\n      if (titleHasExternalAffiliation(affiliationWindow, domain)) continue;'''
if old not in text:
    if new not in text:
        raise SystemExit('candidate affiliation anchor missing')
else:
    text = text.replace(old, new, 1)
p.write_text(text)

pkg = Path('package.json')
pkg_text = pkg.read_text()
pkg_text = pkg_text.replace('"arborlineResearchVersion": "crawler-prose-identity-qc-v5b"', '"arborlineResearchVersion": "crawler-prose-identity-qc-v5c"')
pkg.write_text(pkg_text)
print('Applied scoped title-affiliation guard v5c.')
