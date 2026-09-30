import assert from "node:assert/strict";
import { rankSharedInboxes, scoreContactTarget } from "../../lib/connect-contact-targeting";

const largeUnknownLocation = {
  targetCity: "Chicago",
  targetState: "IL",
  employeeCount: 500,
  locationCount: null
};

const localBranch = scoreContactTarget(
  "Branch Operations Manager",
  "Jordan Lee — Branch Operations Manager — Chicago, IL 60601",
  "https://example.com/locations/chicago-il",
  largeUnknownLocation
);
const corporateExecutive = scoreContactTarget(
  "Chief Executive Officer",
  "Morgan Reed — Chief Executive Officer — Corporate Leadership",
  "https://example.com/leadership",
  largeUnknownLocation
);

assert.equal(localBranch.locationMatch, "TARGET_CITY");
assert.equal(localBranch.roleFunction, "BRANCH_REGIONAL");
assert.ok(localBranch.score > corporateExecutive.score, "local operating leader must outrank unmatched corporate executive");
assert.ok(localBranch.reasons.some((reason) => reason.includes("Function plus geography")));
assert.equal(corporateExecutive.locationMatch, "UNKNOWN");
assert.ok(corporateExecutive.score <= 62, "large unmatched executive should be materially de-emphasized");

const statePostal = scoreContactTarget(
  "Regional Manager",
  "Alex Kim — Regional Manager — Springfield, IL 62701",
  "https://example.com/team",
  { targetCity: "Peoria", targetState: "Illinois", employeeCount: 250, locationCount: null }
);
assert.equal(statePostal.locationMatch, "TARGET_STATE", "postal abbreviation should satisfy full-state target");

const stateFullNameFromCode = scoreContactTarget(
  "Operations Manager",
  "Taylor Green — Operations Manager — Northern Illinois",
  "https://example.com/operations",
  { targetCity: "Rockford", targetState: "IL", employeeCount: 250, locationCount: null }
);
assert.equal(stateFullNameFromCode.locationMatch, "TARGET_STATE", "state code target should match full state name");

const ambiguousIndiana = scoreContactTarget(
  "Chief Executive Officer",
  "Our CEO works in commercial services across several markets.",
  "https://example.com/leadership",
  { targetCity: "Indianapolis", targetState: "IN", employeeCount: 300, locationCount: null }
);
assert.equal(ambiguousIndiana.locationMatch, "UNKNOWN", "ordinary word 'in' must not be treated as Indiana");

const explicitSingleLocation = scoreContactTarget(
  "President",
  "Casey Morgan — President",
  "https://example.com/about",
  { targetCity: "Fort Wayne", targetState: "Indiana", employeeCount: 220, locationCount: 1 }
);
assert.equal(explicitSingleLocation.locationMatch, "SINGLE_LOCATION");
assert.ok(explicitSingleLocation.reasons.some((reason) => reason.includes("single-location")));

const shared = rankSharedInboxes(
  ["operationsil@example.com", "billing@example.com"],
  { targetCity: "Chicago", targetState: "IL", employeeCount: 500, locationCount: null }
);
assert.equal(shared.length, 1);
assert.equal(shared[0]?.email, "operationsil@example.com");
assert.equal(shared[0]?.locationMatch, true);

console.log("Connect function + geography targeting regressions passed.");
