from pathlib import Path

p = Path('lib/connect-public-research.ts')
text = p.read_text()

old = '''function proseNameForTitle(line: string, matchedTitle: string, pageText: string) {\n  const exactTitlePattern = new RegExp(escapeRegex(matchedTitle), "i");\n  const exactTitleIndex = line.search(exactTitlePattern);\n  if (exactTitleIndex < 0) return null;\n  const before = line.slice(Math.max(0, exactTitleIndex - 140), exactTitleIndex);\n  const patterns = [\n    /(?:^|[.!?]\\s+)(?:In\\s+\\d{4}\\s+)?([A-Z][A-Za-z'’.-]{1,30})\\s+(?:became|is|serves\\s+as|was\\s+named|was\\s+appointed|was\\s+promoted\\s+to)\\s+(?:the\\s+)?$/i,\n    /(?:^|[.!?]\\s+)([A-Z][A-Za-z'’.-]{1,30}),\\s+(?:the\\s+)?current\\s+$/i\n  ];\n  for (const pattern of patterns) {\n    const match = before.match(pattern);\n    const given = match?.[1];\n    if (!given) continue;\n    const resolved = resolveGivenNameFromFamilyContext(given, pageText);\n    if (resolved && looksLikePersonName(resolved.name)) return resolved;\n  }\n  return null;\n}'''
new = '''function proseNameForTitle(line: string, matchedTitle: string, pageText: string) {\n  const role = escapeRegex(matchedTitle);\n  const patterns = [\n    new RegExp(`(?:^|[.!?]\\\\s+)(?:In\\\\s+\\\\d{4}\\\\s+)?([A-Z][A-Za-z'’.-]{1,30})\\\\s+(?:became|is|serves\\\\s+as|was\\\\s+named|was\\\\s+appointed|was\\\\s+promoted\\\\s+to)\\\\s+(?:the\\\\s+)?${role}\\\\b`, "i"),\n    new RegExp(`(?:^|[.!?]\\\\s+)([A-Z][A-Za-z'’.-]{1,30}),\\\\s+(?:the\\\\s+)?current\\\\s+${role}\\\\b`, "i")\n  ];\n  for (const pattern of patterns) {\n    const match = line.match(pattern);\n    const given = match?.[1];\n    if (!given) continue;\n    const resolved = resolveGivenNameFromFamilyContext(given, pageText);\n    if (resolved && looksLikePersonName(resolved.name)) return resolved;\n  }\n  return null;\n}'''
if old not in text:
    if new not in text:
        raise SystemExit('prose resolver anchor missing')
else:
    text = text.replace(old, new, 1)

old2 = '''      const path = new URL(page.url).pathname.toLowerCase();\n      const leadershipPage = /team|leadership|people|management|staff|about|contact/.test(path);\n\n      // Adjacent text is much noisier than a same-line name/title pair. It can\n      // still become HIGH confidence when a person-matching published email\n      // corroborates it, but page placement + repetition alone is not enough.\n      let decisionMakerConfidence = proximity === "SAME_LINE" ? 82 : 68;\n      if (leadershipPage) decisionMakerConfidence += 8;\n      if (corroboratingPages >= 2) decisionMakerConfidence += 7;'''
new2 = '''      const path = new URL(page.url).pathname.toLowerCase();\n      const leadershipPage = /team|leadership|people|management|staff|about|contact/.test(path);\n      const strongLeadershipPage = /team|leadership|people|management|staff|executive|officer/.test(path);\n\n      // Adjacent text is noisy on general pages, but a clean name/title pair on\n      // an explicit team/leadership/staff page is authoritative enough to pass\n      // the strong-candidate gate. Generic about/contact adjacency stays lower.\n      let decisionMakerConfidence = proximity === "SAME_LINE" ? 82 : 68;\n      if (strongLeadershipPage && proximity === "ADJACENT_LINE") decisionMakerConfidence += 17;\n      else if (leadershipPage) decisionMakerConfidence += 8;\n      if (corroboratingPages >= 2) decisionMakerConfidence += 7;'''
if old2 not in text:
    if new2 not in text:
        raise SystemExit('leadership confidence anchor missing')
else:
    text = text.replace(old2, new2, 1)

p.write_text(text)

pkg = Path('package.json')
pkg_text = pkg.read_text()
pkg_text = pkg_text.replace('"arborlineResearchVersion": "crawler-prose-identity-qc-v5"', '"arborlineResearchVersion": "crawler-prose-identity-qc-v5b"')
pkg.write_text(pkg_text)
print('Applied crawler precision v5b.')
