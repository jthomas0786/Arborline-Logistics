import fs from "node:fs";
import assert from "node:assert/strict";

const crawler = fs.readFileSync("lib/connect-public-research.ts", "utf8");
const helper = fs.readFileSync("lib/connect-research-route-memory.ts", "utf8");
const migration = fs.readFileSync("db/migrations/073_connect_research_route_memory.sql", "utf8");

for (const marker of [
  "loadConnectResearchRouteMemory(domain)",
  "buildAdaptiveResearchSeeds(domain, baseSeedPaths, routeMemory)",
  "shouldSkipRememberedDeadRoute(url, routeMemory)",
  "persistConnectResearchRouteOutcomes(domain, routeOutcomes)",
  "knownDeadUrlsSkipped",
  "rememberedGoodUrlsPrioritized",
  "routeMemoryWrites"
]) {
  assert.ok(crawler.includes(marker), `crawler route-memory integration missing: ${marker}`);
}

// Existing strict public-email binding rules must survive crawler-efficiency work.
for (const marker of [
  "STRUCTURED_PERSON",
  "MAILTO_PERSON_ANCHOR",
  "strictPublishedObservationForName",
  "GENERIC_EMAIL_LOCAL_PARTS"
]) {
  assert.ok(crawler.includes(marker), `strict email safety marker missing: ${marker}`);
}

assert.ok(helper.includes("const HARD_MISS_TTL_MS = 30 * 24 * 60 * 60 * 1000"), "hard-miss re-probe TTL must remain finite");
assert.ok(helper.includes("outcome.status === 404 || outcome.status === 410"), "only hard 404/410 misses may be persisted as dead routes");
assert.ok(!helper.includes("status === 429") && !helper.includes("status >= 500"), "transient 429/5xx responses must never become remembered dead routes");
assert.ok(helper.includes('add("/");'), "root page must always remain crawlable");
assert.ok(helper.includes("memory.preferredPaths.slice(0, MAX_PREFERRED_PATHS)"), "known-good routes must remain bounded and prioritized");
assert.ok(helper.includes("catch {\n    // Route memory is an optimization only."), "route-memory failure must fail open to normal research");

assert.ok(migration.includes("ENABLE ROW LEVEL SECURITY"), "route-memory table must have RLS enabled");
assert.ok(migration.includes("REVOKE ALL ON TABLE public.connect_research_route_memory FROM anon, authenticated"), "browser roles must not access internal route memory");
assert.ok(migration.includes("WHERE last_status IN (404, 410)"), "dead-route index must remain limited to hard misses");

console.log("Connect crawler route-memory regression guard passed.");
