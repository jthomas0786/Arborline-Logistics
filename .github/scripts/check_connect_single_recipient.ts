import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectCanonicalOutreachRecipient } from "../../lib/connect-outreach-recipient";

const largeProspect = {
  id: "prospect-1",
  city: "Chicago",
  state: "Illinois",
  employee_count: 500,
  location_count: null,
  contact_name: "Morgan Reed",
  contact_title: "Chief Executive Officer",
  contact_email: "morgan@example.com",
  top_level_contact_verified: true,
  updated_at: "2026-09-29T12:00:00Z",
  source_url: "https://example.com/leadership",
  source_metadata: { research: "corporate leadership" },
  verified_person_candidates: [
    {
      id: "candidate-branch",
      contact_name: "Jordan Lee",
      contact_title: "Branch Operations Manager",
      email: "jordan@example.com",
      identity_confidence: 94,
      email_confidence: 98,
      source_kind: "PUBLIC_SITE",
      source_url: "https://example.com/locations/chicago-il",
      evidence: ["Jordan Lee — Branch Operations Manager — Chicago, IL 60601"],
      metadata: { person_binding: true, recipient_type: "PERSON", direct_published: true, identity_bound: true },
      verified_at: "2026-09-29T13:00:00Z"
    }
  ],
  shared_outreach_recipient_email: "operations@example.com"
};

const chosen = selectCanonicalOutreachRecipient(largeProspect);
assert.equal(chosen.outreach_recipient_email, "jordan@example.com");
assert.equal(chosen.outreach_recipient_type, "PERSON");
assert.equal(chosen.outreach_contact_name, "Jordan Lee");
assert.equal(chosen.outreach_contact_title, "Branch Operations Manager");
assert.equal(chosen.outreach_recipient_candidate_id, "candidate-branch");
assert.equal(chosen.outreach_recipient_location_match, "TARGET_CITY");
assert.ok(Number(chosen.outreach_recipient_targeting_score) > 90);

const topLevelFallback = selectCanonicalOutreachRecipient({
  city: "Fort Wayne",
  state: "Indiana",
  employee_count: 30,
  location_count: 1,
  contact_name: "Casey Morgan",
  contact_title: "President",
  contact_email: "casey@example.com",
  top_level_contact_verified: true,
  verified_person_candidates: [],
  shared_outreach_recipient_email: "service@example.com"
});
assert.equal(topLevelFallback.outreach_recipient_email, "casey@example.com");
assert.equal(topLevelFallback.outreach_recipient_type, "PERSON");

const sharedFallback = selectCanonicalOutreachRecipient({
  city: "Madison",
  state: "Wisconsin",
  employee_count: 80,
  location_count: null,
  contact_name: "Unknown Person",
  contact_title: "Operations Manager",
  contact_email: null,
  top_level_contact_verified: false,
  verified_person_candidates: [],
  shared_outreach_recipient_email: "operations@example.com"
});
assert.equal(sharedFallback.outreach_recipient_email, "operations@example.com");
assert.equal(sharedFallback.outreach_recipient_type, "SHARED_INBOX");

const noRecipient = selectCanonicalOutreachRecipient({
  top_level_contact_verified: false,
  verified_person_candidates: [],
  shared_outreach_recipient_email: null
});
assert.equal(noRecipient.outreach_recipient_email, null);
assert.equal(noRecipient.outreach_recipient_type, null);

const draftsSource = readFileSync("lib/connect-outreach-drafts.ts", "utf8");
const senderSource = readFileSync("lib/connect-outreach-send.ts", "utf8");

assert.match(draftsSource, /selectCanonicalOutreachRecipient/);
assert.match(draftsSource, /verified_person_candidates/);
assert.match(draftsSource, /outreach_contact_name/);
assert.match(draftsSource, /outreach_recipient_candidate_id/);
assert.match(senderSource, /cc\.metadata->>'recipient_type'='PERSON'/);
assert.match(senderSource, /cc\.metadata->>'direct_published'='true'/);
assert.match(senderSource, /prior\.status IN \('SENT','DELIVERED'\)/);
assert.match(senderSource, /lower\(prior\.recipient_email\)<>lower\(m\.recipient_email\)/);
assert.match(senderSource, /count\(DISTINCT m\.prospect_id\)::int/);

console.log("Connect canonical recipient + one-recipient autosend regressions passed.");
