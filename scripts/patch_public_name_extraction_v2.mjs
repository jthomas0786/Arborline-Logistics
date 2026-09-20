import fs from "node:fs";

const path = "lib/connect-public-research.ts";
let text = fs.readFileSync(path, "utf8");

function replaceOnce(label, before, after) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(`${label}: source snippet not found`);
  if (text.indexOf(before, first + before.length) >= 0) throw new Error(`${label}: source snippet is not unique`);
  text = text.slice(0, first) + after + text.slice(first + before.length);
}

replaceOnce(
  "name constants",
  'const NAME_PARTICLES = new Set(["al", "bin", "da", "de", "del", "della", "der", "di", "du", "la", "le", "van", "von"]);',
  'const NAME_PARTICLES = new Set(["al", "bin", "da", "de", "del", "della", "der", "di", "du", "la", "le", "van", "von"]);\nconst HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "professor", "sir", "madam"]);\nconst NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);\nconst NON_PERSON_PHRASES = ["master gardener", "stewardship taking", "partners personnel", "yer usa"];'
);

replaceOnce(
  "cleanName",
  `function cleanName(value: string) {\n  return value\n    .replace(/\\s*[|•·–—,:]+\\s*/g, " ")\n    .replace(/^[^A-Za-zÀ-ÖØ-öø-ÿ]+|[^A-Za-zÀ-ÖØ-öø-ÿ.'’-]+$/g, "")\n    .replace(/\\s+/g, " ")\n    // Some CMS/text extractions render a visual separator as a trailing "I"\n    // immediately before the role (for example "Mark Schouten I President").\n    // Prefer the two-token person identity over persisting the separator artifact.\n    .replace(/\\s+I$/, "")\n    .trim();\n}`,
  `function cleanName(value: string) {\n  return value\n    .replace(/\\s*[|•·–—,:]+\\s*/g, " ")\n    .replace(/^(?:sincerely|best regards|kind regards|regards|respectfully)\\s+/i, "")\n    .replace(/^[^A-Za-zÀ-ÖØ-öø-ÿ]+|[^A-Za-zÀ-ÖØ-öø-ÿ.'’-]+$/g, "")\n    .replace(/\\s+/g, " ")\n    // Text such as "Jane Smith Co-Founder" can leave a trailing "Co-" when\n    // the approved title matcher consumes only "Founder". Drop that artifact.\n    .replace(/\\s+Co-$/i, "")\n    // Some CMS/text extractions render a visual separator as a trailing "I"\n    // immediately before the role (for example "Mark Schouten I President").\n    // Prefer the two-token person identity over persisting the separator artifact.\n    .replace(/\\s+I$/, "")\n    .trim();\n}`
);

replaceOnce(
  "personlike normalized tokens",
  `  const normalizedWords = words.map((word) => word.toLowerCase().replace(/[^a-zà-öø-ÿ]/g, ""));\n  // Long adjacent strings without a real name particle are commonly nav/service-area`,
  `  const normalizedWords = words.map((word) => word.toLowerCase().replace(/[^a-zà-öø-ÿ]/g, ""));\n  const normalizedPhrase = normalizeTitle(name);\n  if (NON_PERSON_PHRASES.some((phrase) => normalizedPhrase.includes(phrase))) return false;\n  const substantiveTokens = normalizedWords.filter((word) =>\n    word && !NAME_PARTICLES.has(word) && !HONORIFICS.has(word) && !NAME_SUFFIXES.has(word)\n  );\n  // Honorific + surname alone is not enough identity for safe email inference.\n  // Full identities such as "Dr. Jane Smith" remain valid.\n  if (HONORIFICS.has(normalizedWords[0] ?? "") && substantiveTokens.length < 2) return false;\n  // Long adjacent strings without a real name particle are commonly nav/service-area`
);

replaceOnce(
  "personlike primary token skip",
  `    if (NAME_PARTICLES.has(normalized)) continue;\n    primaryTokens++;`,
  `    if (NAME_PARTICLES.has(normalized) || HONORIFICS.has(normalized) || NAME_SUFFIXES.has(normalized)) continue;\n    primaryTokens++;`
);

replaceOnce(
  "email name parts",
  `  const parts = name.split(/\\s+/).map(normalizeNameToken).filter(Boolean);\n  if (parts.length < 2 || !local) return false;`,
  `  const parts = name.split(/\\s+/)\n    .map(normalizeNameToken)\n    .filter((part) => part && !HONORIFICS.has(part) && !NAME_SUFFIXES.has(part));\n  if (parts.length < 2 || !local) return false;`
);

replaceOnce(
  "inferred email name parts",
  `  const parts = name.split(/\\s+/).map(normalizeNameToken).filter(Boolean);\n  if (parts.length < 2) return [];`,
  `  const parts = name.split(/\\s+/)\n    .map(normalizeNameToken)\n    .filter((part) => part && !HONORIFICS.has(part) && !NAME_SUFFIXES.has(part));\n  if (parts.length < 2) return [];`
);

fs.writeFileSync(path, text);
console.log("Patched public-name extraction safely.");
