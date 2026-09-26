from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str):
    p = Path(path)
    text = p.read_text()
    if new in text:
        print(f"already applied: {label}")
        return
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one anchor, found {count}")
    p.write_text(text.replace(old, new, 1))

public = "lib/connect-public-research.ts"
package = "package.json"

replace_once(
    public,
    '''function isHighValueResearchUrl(value: string) {\n  try { return /team|leadership|people|management|staff|executive|officer|owner|founder|about|contact|location|branch|profile|bio/.test(new URL(value).pathname.toLowerCase()); } catch { return false; }\n}''',
    '''function isHighValueResearchUrl(value: string) {\n  try {\n    const path = new URL(value).pathname.toLowerCase();\n    if (/\\/(?:news|newsroom|blog|press|media|article|articles|events?|resources?)(?:\\/|$)/.test(path)) return false;\n    const segments = path.split("/").filter(Boolean);\n    return segments.some((segment) => /^(?:team|our-team|leadership|people|our-people|management|staff|staff-directory|directory|executive|executives|officer|officers|owner|owners|founder|founders|about|about-us|contact|contact-us|locations?|branches?|profile|profiles|bio|bios|who-we-are|meet-the-team|meet-our-team)$/.test(segment));\n  } catch { return false; }\n}''',
    "high-value URL precision"
)

replace_once(
    public,
    '''      ...(options.expanded ? [\n        `https://${domain}/staff`,\n        `https://${domain}/people`,\n        `https://${domain}/our-people`,\n        `https://${domain}/management`,\n        `https://${domain}/company`,\n        `https://${domain}/our-company`,\n        `https://${domain}/meet-the-team`,\n        `https://${domain}/meet-our-team`,\n        `https://${domain}/staff-directory`,\n        `https://${domain}/directory`,\n        `https://${domain}/professionals`,\n        `https://${domain}/employees`,\n        `https://${domain}/about/team`,\n        `https://${domain}/about/leadership`,\n        `https://${domain}/who-we-are`,\n        `https://${domain}/locations`\n      ] : [])''',
    '''      ...(options.expanded ? [\n        `https://${domain}/staff`,\n        `https://${domain}/people`,\n        `https://${domain}/who-we-are`,\n        `https://${domain}/locations`\n      ] : [])''',
    "bounded expanded seed URLs"
)

replace_once(
    public,
    '''      const fetched = fetchResult.value;\n      if (fetched.contentType && !fetched.contentType.includes("text/html") && !fetched.contentType.includes("text/plain")) {''',
    '''      const fetched = fetchResult.value;\n      let fetchedUrl: URL;\n      try { fetchedUrl = new URL(fetched.url); } catch { continue; }\n      const fetchedKey = `${fetchedUrl.protocol}//${normalizeHost(fetchedUrl.hostname)}${fetchedUrl.pathname}`.replace(/\\/$/, "") || domain;\n      if (fetchedKey !== key && visited.has(fetchedKey)) continue;\n      visited.add(fetchedKey);\n      if (pages.some((page) => {\n        try {\n          const pageUrl = new URL(page.url);\n          const pageKey = `${pageUrl.protocol}//${normalizeHost(pageUrl.hostname)}${pageUrl.pathname}`.replace(/\\/$/, "") || domain;\n          return pageKey === fetchedKey;\n        } catch { return false; }\n      })) continue;\n      if (fetched.contentType && !fetched.contentType.includes("text/html") && !fetched.contentType.includes("text/plain")) {''',
    "final URL page dedupe"
)

replace_once(
    public,
    '''function candidateFromPages(pages: PageSnapshot[], domain: string, approvedTitles: string[], emailPatternObservations: PublicEmailPatternObservation[] = [], targetingContext: ContactTargetingContext = {}): PublicResearchCandidate | null {''',
    '''function extractFullNameMentions(text: string) {\n  const matches = [...text.matchAll(/\\b([A-Z][A-Za-z'’.-]{1,30})\\s+([A-Z][A-Za-z'’.-]{1,40})\\b/g)];\n  return matches\n    .map((match) => ({ first: match[1], last: match[2], full: `${match[1]} ${match[2]}` }))\n    .filter((item) => looksLikePersonName(item.full));\n}\n\nfunction resolveGivenNameFromFamilyContext(givenName: string, pageText: string) {\n  const normalizedGiven = givenName.toLowerCase();\n  const names = extractFullNameMentions(pageText);\n  const direct = names.find((item) => item.first.toLowerCase() === normalizedGiven);\n  if (direct) return { name: direct.full, reason: "DIRECT_FULL_NAME_ON_PAGE" };\n\n  const surnameVotes = new Map<string, number>();\n  const vote = (surname: string) => surnameVotes.set(surname, (surnameVotes.get(surname) ?? 0) + 1);\n  for (const item of names) {\n    const escapedFull = escapeRegex(item.full);\n    const escapedGiven = escapeRegex(givenName);\n    const childOfGiven = new RegExp(`${escapedFull}[^.!?]{0,60}${escapedGiven}[’']s\\s+(?:son|daughter)`, "i");\n    if (childOfGiven.test(pageText)) vote(item.last);\n\n    const escapedFirst = escapeRegex(item.first);\n    const givenChildOfNamedParent = new RegExp(`${escapedGiven}[^.!?]{0,80}${escapedFirst}[’']s\\s+(?:son|daughter)`, "i");\n    if (givenChildOfNamedParent.test(pageText)) vote(item.last);\n  }\n  const ranked = [...surnameVotes.entries()].sort((a, b) => b[1] - a[1]);\n  if (!ranked.length) return null;\n  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return null;\n  return { name: `${givenName} ${ranked[0][0]}`, reason: "EXPLICIT_FAMILY_RELATIONSHIP" };\n}\n\nfunction proseNameForTitle(line: string, matchedTitle: string, pageText: string) {\n  const exactTitlePattern = new RegExp(escapeRegex(matchedTitle), "i");\n  const exactTitleIndex = line.search(exactTitlePattern);\n  if (exactTitleIndex < 0) return null;\n  const before = line.slice(Math.max(0, exactTitleIndex - 140), exactTitleIndex);\n  const patterns = [\n    /(?:^|[.!?]\\s+)(?:In\\s+\\d{4}\\s+)?([A-Z][A-Za-z'’.-]{1,30})\\s+(?:became|is|serves\\s+as|was\\s+named|was\\s+appointed|was\\s+promoted\\s+to)\\s+(?:the\\s+)?$/i,\n    /(?:^|[.!?]\\s+)([A-Z][A-Za-z'’.-]{1,30}),\\s+(?:the\\s+)?current\\s+$/i\n  ];\n  for (const pattern of patterns) {\n    const match = before.match(pattern);\n    const given = match?.[1];\n    if (!given) continue;\n    const resolved = resolveGivenNameFromFamilyContext(given, pageText);\n    if (resolved && looksLikePersonName(resolved.name)) return resolved;\n  }\n  return null;\n}\n\nfunction candidateFromPages(pages: PageSnapshot[], domain: string, approvedTitles: string[], emailPatternObservations: PublicEmailPatternObservation[] = [], targetingContext: ContactTargetingContext = {}): PublicResearchCandidate | null {''',
    "prose executive and family context helpers"
)

replace_once(
    public,
    '''      const adjacentName = [lines[index - 1], lines[index + 1]]\n        .filter((value): value is string => Boolean(value))\n        .map(cleanName)\n        .find(looksLikePersonName) ?? null;\n      const name = sameLineName ?? adjacentName;\n      if (!name) continue;\n      if (sameLineName && looksLikeExternalOrganizationLabel(lines[index + 1] ?? "", domain)) continue;\n\n      const proximity: "SAME_LINE" | "ADJACENT_LINE" = sameLineName ? "SAME_LINE" : "ADJACENT_LINE";''',
    '''      const adjacentName = [lines[index - 1], lines[index + 1]]\n        .filter((value): value is string => Boolean(value))\n        .map(cleanName)\n        .find(looksLikePersonName) ?? null;\n      const proseResolved = !sameLineName && !adjacentName ? proseNameForTitle(line, matchedTitle, page.text) : null;\n      const name = sameLineName ?? adjacentName ?? proseResolved?.name ?? null;\n      if (!name) continue;\n      if (sameLineName && looksLikeExternalOrganizationLabel(lines[index + 1] ?? "", domain)) continue;\n\n      const proximity: "SAME_LINE" | "ADJACENT_LINE" = sameLineName || proseResolved ? "SAME_LINE" : "ADJACENT_LINE";''',
    "prose candidate extraction"
)

replace_once(
    public,
    '''      const evidence = [\n        `${name} appears ${proximity === "SAME_LINE" ? "on the same line as" : "directly beside"} an approved decision-maker title (${matchedTitle}) on ${path || "/"}.`,''',
    '''      const evidence = [\n        proseResolved\n          ? `${name} is resolved from an explicit title statement (${matchedTitle}) plus ${proseResolved.reason === "EXPLICIT_FAMILY_RELATIONSHIP" ? "a same-page family relationship" : "a full-name mention"} on ${path || "/"}.`\n          : `${name} appears ${proximity === "SAME_LINE" ? "on the same line as" : "directly beside"} an approved decision-maker title (${matchedTitle}) on ${path || "/"}.`,''',
    "prose candidate evidence"
)

replace_once(
    package,
    '"arborlineResearchVersion": "crawler-diagnostics-identity-qc-v4"',
    '"arborlineResearchVersion": "crawler-prose-identity-qc-v5"',
    "research version v5"
)

print("Applied crawler precision v5.")
