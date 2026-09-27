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
    text = text.replace(old, new, 1)

page_anchor = '''    const path = new URL(page.url).pathname.toLowerCase();
    const narrativeEligiblePage = /about|company|history|team|leadership|people|management|staff/.test(path);
    if (narrativeEligiblePage) {'''
page_debug = '''    const path = new URL(page.url).pathname.toLowerCase();
    const narrativeEligiblePage = /about|company|history|team|leadership|people|management|staff/.test(path);
    if (domain === "andrewsheating.com") {
      const firstDoug = page.text.indexOf("Doug");
      const presidentIndex = page.text.indexOf("In 2005 Doug became President");
      console.log("ANDREWS_PAGE_TRACE", JSON.stringify({
        url: page.url,
        path,
        narrativeEligiblePage,
        textLength: page.text.length,
        firstDoug,
        presidentIndex,
        hasNathan: page.text.includes("Nathan Andrews"),
        hasDennisAndrews: page.text.includes("Dennis Andrews"),
        snippet: firstDoug >= 0 ? page.text.slice(Math.max(0, firstDoug - 240), Math.min(page.text.length, firstDoug + 1200)) : null,
        approvedTitles
      }));
    }
    if (narrativeEligiblePage) {'''
if "ANDREWS_PAGE_TRACE" not in text:
    if page_anchor not in text:
        raise SystemExit("candidate page anchor not found")
    text = text.replace(page_anchor, page_debug, 1)

statement_anchor = '''        const statementPattern = new RegExp(`(?:^|[.!?]\\s+)(?:In\\s+\\d{4}\\s+)?([A-Z][A-Za-z'’.-]{1,30})\\s+(?:became|is|serves\\s+as|was\\s+named|was\\s+appointed|was\\s+promoted\\s+to)\\s+(?:the\\s+)?${role}\\b`, "gi");
        for (const statement of page.text.matchAll(statementPattern)) {
          const givenName = statement[1];
          if (!givenName) continue;
          const resolved = resolveGivenNameFromFamilyContext(givenName, page.text);
          if (!resolved || !looksLikePersonName(resolved.name)) continue;
          const statementText = statement[0] ?? "";
          const statementIndex = statement.index ?? 0;
          const statementWindow = page.text.slice(Math.max(0, statementIndex - 80), Math.min(page.text.length, statementIndex + statementText.length + 180));
          if (titleHasExternalAffiliation(statementWindow, domain)) continue;'''
statement_debug = '''        const statementPattern = new RegExp(`(?:^|[.!?]\\s+)(?:In\\s+\\d{4}\\s+)?([A-Z][A-Za-z'’.-]{1,30})\\s+(?:became|is|serves\\s+as|was\\s+named|was\\s+appointed|was\\s+promoted\\s+to)\\s+(?:the\\s+)?${role}\\b`, "gi");
        const statements = [...page.text.matchAll(statementPattern)];
        if (domain === "andrewsheating.com" && /^(?:Owner|President|CEO)$/i.test(approvedTitle)) {
          console.log("ANDREWS_ROLE_TRACE", JSON.stringify({
            url: page.url,
            approvedTitle,
            role,
            count: statements.length,
            matches: statements.map((item) => ({ text: item[0], givenName: item[1], index: item.index }))
          }));
        }
        for (const statement of statements) {
          const givenName = statement[1];
          if (!givenName) continue;
          const resolved = resolveGivenNameFromFamilyContext(givenName, page.text);
          const personLike = Boolean(resolved && looksLikePersonName(resolved.name));
          const statementText = statement[0] ?? "";
          const statementIndex = statement.index ?? 0;
          const statementWindow = page.text.slice(Math.max(0, statementIndex - 80), Math.min(page.text.length, statementIndex + statementText.length + 180));
          const externalAffiliation = titleHasExternalAffiliation(statementWindow, domain);
          if (domain === "andrewsheating.com" && /^(?:Owner|President|CEO)$/i.test(approvedTitle)) {
            console.log("ANDREWS_STATEMENT_TRACE", JSON.stringify({ approvedTitle, givenName, resolved, personLike, externalAffiliation, statementWindow }));
          }
          if (!resolved || !personLike) continue;
          if (externalAffiliation) continue;'''
if "ANDREWS_STATEMENT_TRACE" not in text:
    if statement_anchor not in text:
        raise SystemExit("statement anchor not found")
    text = text.replace(statement_anchor, statement_debug, 1)

source.write_text(text)

package = Path("package.json")
package_text = package.read_text()
old_version = '"arborlineResearchVersion": "crawler-narrative-exec-v5d"'
new_version = '"arborlineResearchVersion": "crawler-narrative-exec-v5e"'
if new_version not in package_text:
    if old_version not in package_text:
        raise SystemExit("research version anchor not found; refusing version rewrite")
    package.write_text(package_text.replace(old_version, new_version, 1))
