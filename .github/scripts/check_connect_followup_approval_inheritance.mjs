import fs from "node:fs";

const followUps = fs.readFileSync("lib/connect-outreach-followups.ts", "utf8");
const sender = fs.readFileSync("lib/connect-outreach-send.ts", "utf8");
const drafts = fs.readFileSync("lib/connect-outreach-drafts.ts", "utf8");

const checks = [
  ["follow-up source requires an original approval timestamp", followUps.includes("m.approved_at IS NOT NULL")],
  ["follow-up source requires an original approving user", followUps.includes("m.approved_by_user_id IS NOT NULL")],
  ["follow-up source restricts inherited approval sources", followUps.includes("m.approval_source = ANY($3::text[])")],
  ["follow-up message persists approval evidence", followUps.includes("approved_at,approved_by_user_id,approval_source")],
  ["follow-up message is queued only with inherited evidence", followUps.includes("'QUEUED',$7,$8,$9,$10,$11")],
  ["follow-up copies the original approval timestamp", followUps.includes("prospect.original_approved_at")],
  ["follow-up copies the original approving user", followUps.includes("prospect.original_approved_by_user_id")],
  ["follow-up copies the original approval source", followUps.includes("prospect.original_approval_source")],
  ["follow-up queues the prospect transactionally", followUps.includes("SET outreach_status='QUEUED',updated_at=now()")],
  ["follow-up still requires current verified contact", followUps.includes("public.connect_contact_is_verified(p)")],
  ["follow-up still blocks existing replies", followUps.includes("SELECT 1 FROM connect_replies r WHERE r.prospect_id=p.id")],
  ["follow-up still blocks suppressions", followUps.includes("SELECT 1 FROM connect_suppressions s")],
  ["sender still requires approval timestamp", sender.includes("m.approved_at IS NOT NULL")],
  ["sender still requires approving user", sender.includes("m.approved_by_user_id IS NOT NULL")],
  ["sender still restricts approval sources", sender.includes("m.approval_source IN ('STAFF_SINGLE','STAFF_BATCH_CONFIRMED','LEGACY_USER_CONFIRMED')")],
  ["unverified prepared-draft promotion remains review-only", /export async function promotePreparedOutreachDrafts[\s\S]*?'DRAFT'/.test(drafts)],
  ["follow-up code does not fabricate SYSTEM approval", !followUps.includes("approval_source='SYSTEM'") && !followUps.includes("'SYSTEM'")]
];

const failed = checks.filter(([, passed]) => !passed);
for (const [name, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"}: ${name}`);
}

if (failed.length) {
  console.error(`\n${failed.length} Connect follow-up approval safety check(s) failed.`);
  process.exit(1);
}

console.log("\nConnect follow-up approval inheritance safety checks passed.");
