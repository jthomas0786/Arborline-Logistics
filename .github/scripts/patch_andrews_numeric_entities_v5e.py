from pathlib import Path

source = Path("lib/connect-public-research.ts")
text = source.read_text()

old = '''function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '\"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}'''

new = '''function decodeHtml(value: string) {
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

if new not in text:
    if old not in text:
        raise SystemExit("decodeHtml anchor not found; refusing broad parser edit")
    source.write_text(text.replace(old, new, 1))

package = Path("package.json")
package_text = package.read_text()
old_version = '"arborlineResearchVersion": "crawler-narrative-exec-v5d"'
new_version = '"arborlineResearchVersion": "crawler-narrative-exec-v5e"'
if new_version not in package_text:
    if old_version not in package_text:
        raise SystemExit("research version anchor not found; refusing version rewrite")
    package.write_text(package_text.replace(old_version, new_version, 1))
