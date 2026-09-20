import fs from "node:fs";

// One-time source patcher for native candidate identity normalization.
const path = "lib/connect-native-enrichment.ts";
let text = fs.readFileSync(path, "utf8");

function replaceOnce(label, before, after) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(`${label}: source snippet not found`);
  if (text.indexOf(before, first + before.length) >= 0) throw new Error(`${label}: source snippet is not unique`);
  text = text.slice(0, first) + after + text.slice(first + before.length);
}

replaceOnce(
  "name token constants",
  'type MxStatus = "VALID" | "MISSING" | "TEMPORARY_ERROR" | "UNKNOWN";\ntype NativeEmailStatus = "PUBLISHED_UNVERIFIED" | "INFERRED_UNVERIFIED" | "SYNTAX_VALID" | "MX_VALID";',
  'type MxStatus = "VALID" | "MISSING" | "TEMPORARY_ERROR" | "UNKNOWN";\ntype NativeEmailStatus = "PUBLISHED_UNVERIFIED" | "INFERRED_UNVERIFIED" | "SYNTAX_VALID" | "MX_VALID";\n\nconst NAME_HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "professor", "sir", "madam"]);\nconst NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);'
);

replaceOnce(
  "nameParts",
  `function nameParts(value: string | null | undefined) {\n  const parts = (value ?? "").trim().split(/\\s+/).map(normalizeNamePart).filter(Boolean);\n  if (parts.length < 2) return null;\n  return { first: parts[0], last: parts[parts.length - 1] };\n}`,
  `function nameParts(value: string | null | undefined) {\n  const parts = (value ?? "")\n    .trim()\n    .split(/\\s+/)\n    .map(normalizeNamePart)\n    .filter((part) => part && !NAME_HONORIFICS.has(part) && !NAME_SUFFIXES.has(part));\n  if (parts.length < 2) return null;\n  return { first: parts[0], last: parts[parts.length - 1] };\n}`
);

replaceOnce(
  "stale inferred candidate gate",
  `    for (const email of inferred.slice(0, 4)) {\n      if (!sameCompanyDomain(email, domain) || proposed.has(email)) continue;\n      proposed.set(email, {\n        sourceKind: "LEARNED_PATTERN",\n        pattern: derivePattern(name, email, domain),`,
  `    for (const email of inferred.slice(0, 4)) {\n      const inferredPattern = derivePattern(name, email, domain);\n      if (!sameCompanyDomain(email, domain) || proposed.has(email) || !inferredPattern) continue;\n      proposed.set(email, {\n        sourceKind: "LEARNED_PATTERN",\n        pattern: inferredPattern,`
);

fs.writeFileSync(path, text);
console.log("Patched native contact name parsing and stale inferred-candidate gating.");
