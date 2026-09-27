from pathlib import Path

source = Path("lib/connect-public-research.ts")
text = source.read_text()

old_decode = r'''function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}'''

new_decode = r'''function decodeHtml(value: string) {
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
    .replace(/&#(\d+);/g, (match, rawCodePoint: string) => decodeNumericEntity(match, rawCodePoint, 10))
    .replace(/&#x([0-9a-f]+);/gi, (match, rawCodePoint: string) => decodeNumericEntity(match, rawCodePoint, 16))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}'''

if new_decode not in text:
    if old_decode not in text:
        raise SystemExit("decodeHtml anchor not found; refusing broad parser edit")
    text = text.replace(old_decode, new_decode, 1)

# Dynamic RegExp strings need two source backslashes so the runtime pattern
# receives a real \s whitespace token. The old strings contain only one source
# backslash, which JavaScript consumes while evaluating the template literal.
bad_child = r'''    const childOfGiven = new RegExp(`${escapedFull}[^.!?]{0,60}${escapedGiven}[’']s\s+(?:son|daughter)`, "i");'''
good_child = r'''    const childOfGiven = new RegExp(`${escapedFull}[^.!?]{0,60}${escapedGiven}[’']s\\s+(?:son|daughter)`, "i");'''
bad_parent = r'''    const givenChildOfNamedParent = new RegExp(`${escapedGiven}[^.!?]{0,80}${escapedFirst}[’']s\s+(?:son|daughter)`, "i");'''
good_parent = r'''    const givenChildOfNamedParent = new RegExp(`${escapedGiven}[^.!?]{0,80}${escapedFirst}[’']s\\s+(?:son|daughter)`, "i");'''

if good_child not in text:
    if bad_child not in text:
        raise SystemExit("child family-regex anchor not found; refusing broad parser edit")
    text = text.replace(bad_child, good_child, 1)
if good_parent not in text:
    if bad_parent not in text:
        raise SystemExit("parent family-regex anchor not found; refusing broad parser edit")
    text = text.replace(bad_parent, good_parent, 1)

source.write_text(text)

package = Path("package.json")
package_text = package.read_text()
old_version = '"arborlineResearchVersion": "crawler-narrative-exec-v5d"'
new_version = '"arborlineResearchVersion": "crawler-narrative-exec-v5e"'
if new_version not in package_text:
    if old_version not in package_text:
        raise SystemExit("research version anchor not found; refusing version rewrite")
    package.write_text(package_text.replace(old_version, new_version, 1))
