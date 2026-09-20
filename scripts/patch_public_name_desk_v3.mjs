import fs from "node:fs";

const path = "lib/connect-public-research.ts";
let text = fs.readFileSync(path, "utf8");
const before = '  "outgoing", "incoming", "former", "retiring", "retired", "interim", "association", "associations"';
const after = '  "outgoing", "incoming", "appointed", "former", "retiring", "retired", "interim", "association", "associations"';
if (!text.includes(before)) {
  if (text.includes(after)) {
    console.log("Appointed-text hardening already applied.");
    process.exit(0);
  }
  throw new Error("NON_PERSON_TERMS tail not found");
}
text = text.replace(before, after);
fs.writeFileSync(path, text);
console.log("Added appointed to public-research non-person terms.");
