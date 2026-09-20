import fs from "node:fs";

const path = "lib/connect-public-research.ts";
let text = fs.readFileSync(path, "utf8");
const before = '.replace(/^(?:sincerely|best regards|kind regards|regards|respectfully)\\s+/i, "")';
const after = '.replace(/^(?:sincerely|best regards|kind regards|regards|respectfully|operator)\\s+/i, "")';
if (!text.includes(before)) {
  if (text.includes(after)) {
    console.log("Operator prefix hardening already applied.");
    process.exit(0);
  }
  throw new Error("cleanName prefix-normalization source line not found");
}
text = text.replace(before, after);
fs.writeFileSync(path, text);
console.log("Added Operator prefix normalization to public research parser.");
