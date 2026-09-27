from pathlib import Path

source = Path("lib/connect-public-research.ts")
text = source.read_text()

old_decode = '''function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '\"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}'''

new_decode = '''function decodeHtml(value: string) {
  const decodeNumericEntity = (match: string, rawCodePoint: string, radix: number) => {
    const codePoint = Number.parseInt(rawCodePoint, radix);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return match;
    }
  };

  return value
    .replace(/&#(\\d+);/g, (match, rawCodePoint: string) => decodeNumericEntity(match, rawCodePoint, 10))
    .replace(/&#x([0-9a-f]+);/gi, (match, rawCodePoint: string) => decodeNumericEntity(match, rawCodePoint, 16))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '\"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}'''

if new_decode not in text:
    if old_decode not in text:
        raise SystemExit("decodeHtml anchor not found; refusing broad parser edit")
    text = text.replace(old_decode, new_decode, 1)

old_resolver = '''function resolveGivenNameFromFamilyContext(givenName: string, pageText: string) {
  const normalizedGiven = givenName.toLowerCase();
  const names = extractFullNameMentions(pageText);
  const direct = names.find((item) => item.first.toLowerCase() === normalizedGiven);
  if (direct) return { name: direct.full, reason: "DIRECT_FULL_NAME_ON_PAGE" };

  const surnameVotes = new Map<string, number>();
  const vote = (surname: string) => surnameVotes.set(surname, (surnameVotes.get(surname) ?? 0) + 1);
  for (const item of names) {
    const escapedFull = escapeRegex(item.full);
    const escapedGiven = escapeRegex(givenName);
    const childOfGiven = new RegExp(`${escapedFull}[^.!?]{0,60}${escapedGiven}[’']s\\s+(?:son|daughter)`, "i");
    if (childOfGiven.test(pageText)) vote(item.last);

    const escapedFirst = escapeRegex(item.first);
    const givenChildOfNamedParent = new RegExp(`${escapedGiven}[^.!?]{0,80}${escapedFirst}[’']s\\s+(?:son|daughter)`, "i");
    if (givenChildOfNamedParent.test(pageText)) vote(item.last);
  }
  const ranked = [...surnameVotes.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return null;
  return { name: `${givenName} ${ranked[0][0]}`, reason: "EXPLICIT_FAMILY_RELATIONSHIP" };
}'''

new_resolver = '''function resolveGivenNameFromFamilyContext(givenName: string, pageText: string) {
  const normalizedGiven = givenName.toLowerCase();
  const names = extractFullNameMentions(pageText);
  const direct = names.find((item) => item.first.toLowerCase() === normalizedGiven);
  if (direct) return { name: direct.full, reason: "DIRECT_FULL_NAME_ON_PAGE" };

  // Prefer an explicit reverse family statement such as
  // "Nathan Andrews, Doug’s son". This is deliberately narrow: the relative
  // must be a valid full person name and all matching statements must agree on
  // one surname before that surname can be assigned to the titled given name.
  const escapedGiven = escapeRegex(givenName);
  const explicitChildPattern = new RegExp(
    `\\b([A-Z][A-Za-z'’.-]{1,30})\\s+([A-Z][A-Za-z'’.-]{1,40})\\s*,?[^.!?]{0,24}\\b${escapedGiven}[’']s\\s+(?:son|daughter)\\b`,
    "g"
  );
  const explicitFamilySurnames = new Set<string>();
  for (const match of pageText.matchAll(explicitChildPattern)) {
    const relativeName = cleanName(`${match[1] ?? ""} ${match[2] ?? ""}`);
    const surname = match[2] ?? "";
    if (!surname || !looksLikePersonName(relativeName)) continue;
    explicitFamilySurnames.add(surname);
  }
  if (explicitFamilySurnames.size === 1) {
    return { name: `${givenName} ${[...explicitFamilySurnames][0]}`, reason: "EXPLICIT_FAMILY_RELATIONSHIP" };
  }

  const surnameVotes = new Map<string, number>();
  const vote = (surname: string) => surnameVotes.set(surname, (surnameVotes.get(surname) ?? 0) + 1);
  for (const item of names) {
    const escapedFull = escapeRegex(item.full);
    const childOfGiven = new RegExp(`${escapedFull}[^.!?]{0,60}${escapedGiven}[’']s\\s+(?:son|daughter)`, "i");
    if (childOfGiven.test(pageText)) vote(item.last);

    const escapedFirst = escapeRegex(item.first);
    const givenChildOfNamedParent = new RegExp(`${escapedGiven}[^.!?]{0,80}${escapedFirst}[’']s\\s+(?:son|daughter)`, "i");
    if (givenChildOfNamedParent.test(pageText)) vote(item.last);
  }
  const ranked = [...surnameVotes.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return null;
  return { name: `${givenName} ${ranked[0][0]}`, reason: "EXPLICIT_FAMILY_RELATIONSHIP" };
}'''

if new_resolver not in text:
    if old_resolver not in text:
        raise SystemExit("family resolver anchor not found; refusing broad parser edit")
    text = text.replace(old_resolver, new_resolver, 1)

source.write_text(text)

package = Path("package.json")
package_text = package.read_text()
old_version = '"arborlineResearchVersion": "crawler-narrative-exec-v5d"'
new_version = '"arborlineResearchVersion": "crawler-narrative-exec-v5e"'
if new_version not in package_text:
    if old_version not in package_text:
        raise SystemExit("research version anchor not found; refusing version rewrite")
    package.write_text(package_text.replace(old_version, new_version, 1))
