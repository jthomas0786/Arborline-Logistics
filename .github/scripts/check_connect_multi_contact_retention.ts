import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  retainDistinctDecisionMakerCandidates,
  type PublicResearchCandidate
} from "../../lib/connect-public-research";

function candidate(
  name: string,
  title: string,
  decisionMakerConfidence: number,
  targetingScore: number,
  sourceUrl: string
): PublicResearchCandidate {
  return {
    name,
    title,
    decisionMakerConfidence,
    confidenceGrade: decisionMakerConfidence >= 85 ? "HIGH" : decisionMakerConfidence >= 70 ? "MEDIUM" : "LOW",
    corroboratingPages: 1,
    proximity: "SAME_LINE",
    sourceKind: "PUBLIC_SITE",
    publishedEmail: null,
    emailConfidence: 0,
    inferredEmailCandidates: [],
    sourceUrl,
    targetingScore,
    targetingCompanySize: "LARGE",
    targetingRoleFunction: title.includes("Operations") ? "OPERATIONS" : "EXECUTIVE",
    targetingSeniority: title.includes("Manager") ? "MANAGER" : "C_SUITE",
    targetingLocationMatch: sourceUrl.includes("chicago") ? "TARGET_CITY" : "UNKNOWN",
    targetingReasons: [],
    evidence: [`${name} — ${title}`]
  };
}

const primary = candidate("Jordan Lee", "Branch Operations Manager", 94, 100, "https://example.com/chicago/team");
const duplicateJordan = candidate("Jordan Lee", "Operations Manager", 90, 98, "https://example.com/chicago/operations");
const secondPerson = candidate("Morgan Reed", "Chief Executive Officer", 93, 62, "https://example.com/leadership");
const thirdPerson = candidate("Alex Kim", "Regional Operations Manager", 91, 97, "https://example.com/chicago/region");
const weakPerson = candidate("Pat Low", "President", 79, 90, "https://example.com/about");

const retained = retainDistinctDecisionMakerCandidates(
  primary,
  [duplicateJordan, secondPerson, thirdPerson, weakPerson],
  6
);
assert.equal(retained[0]?.name, "Jordan Lee", "existing primary winner must remain first");
assert.equal(retained.filter((item) => item.name === "Jordan Lee").length, 1, "same person must be deduplicated");
assert.deepEqual(retained.map((item) => item.name), ["Jordan Lee", "Alex Kim", "Morgan Reed"]);
assert.ok(!retained.some((item) => item.name === "Pat Low"), "sub-85 identity must not be retained as a secondary decision maker");

const noPrimary = retainDistinctDecisionMakerCandidates(null, [secondPerson, thirdPerson], 6);
assert.deepEqual(noPrimary.map((item) => item.name), ["Alex Kim", "Morgan Reed"]);

const researchSource = readFileSync("lib/connect-public-research.ts", "utf8");
const deepSource = readFileSync("lib/connect-deep-research-workers.ts", "utf8");
const senderSource = readFileSync("lib/connect-outreach-send.ts", "utf8");

assert.match(researchSource, /candidates\?: PublicResearchCandidate\[\]/);
assert.match(researchSource, /decision_maker_candidates/);
assert.match(researchSource, /persistPublicResearchCandidates/);
assert.match(researchSource, /research_identity_only/);
assert.match(researchSource, /mailbox_verified: false/);
assert.match(deepSource, /persistPublicResearchCandidates/);
assert.match(senderSource, /prior\.status IN \('SENT','DELIVERED'\)/);
assert.match(senderSource, /lower\(prior\.recipient_email\)<>lower\(m\.recipient_email\)/);

console.log("Connect multi-contact retention regressions passed.");
