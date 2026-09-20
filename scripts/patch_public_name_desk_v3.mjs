import fs from "node:fs";

const path = "lib/connect-public-research.ts";
let text = fs.readFileSync(path, "utf8");
const before = 'const NON_PERSON_PHRASES = ["master gardener", "stewardship taking", "partners personnel", "yer usa"];';
const after = 'const NON_PERSON_PHRASES = ["master gardener", "stewardship taking", "partners personnel", "yer usa", "german desk"];';
if (!text.includes(before)) throw new Error("NON_PERSON_PHRASES source line not found");
text = text.replace(before, after);
fs.writeFileSync(path, text);
console.log("Added German Desk non-person parser rejection.");
