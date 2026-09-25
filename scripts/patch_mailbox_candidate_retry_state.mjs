import fs from "node:fs";

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first === -1) throw new Error(`Missing patch anchor: ${label}`);
  if (source.indexOf(from, first + from.length) !== -1) throw new Error(`Patch anchor is not unique: ${label}`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

const protocolPath = "lib/connect-mailbox-worker-protocol.ts";
let protocol = fs.readFileSync(protocolPath, "utf8");

protocol = replaceOnce(
  protocol,
  `             AND (\n               lower(coalesce(c.metadata->>'direct_published','false'))='true'\n               OR lower(coalesce(c.metadata->>'published_email_confirmed','false'))='true'\n             )\n           )`,
  `             AND (\n               lower(coalesce(c.metadata->>'direct_published','false'))='true'\n               OR lower(coalesce(c.metadata->>'published_email_confirmed','false'))='true'\n             )\n             AND c.mailbox_retry_exhausted_at IS NULL\n             AND (c.mailbox_next_retry_at IS NULL OR c.mailbox_next_retry_at<=now())\n             AND c.mailbox_retry_count < CASE\n               WHEN coalesce(c.mailbox_last_status,c.email_status) IN ('UNKNOWN','NETWORK_BLOCKED') THEN 5\n               ELSE 6\n             END\n           )`,
  "retry eligibility ceiling"
);

protocol = replaceOnce(
  protocol,
  `    const found = await client.query<ClaimedCandidate & { consecutive_failures: number }>(`,
  `    const found = await client.query<ClaimedCandidate & {\n      consecutive_failures: number;\n      mailbox_retry_count: number;\n      mailbox_last_status: string | null;\n      mailbox_next_retry_at: Date | null;\n      mailbox_retry_exhausted_at: Date | null;\n    }>(`,
  "claimed candidate retry state type"
);

protocol = replaceOnce(
  protocol,
  `              ds.consecutive_failures\n       FROM connect_contact_candidates c`,
  `              ds.consecutive_failures,c.mailbox_retry_count,c.mailbox_last_status,c.mailbox_next_retry_at,c.mailbox_retry_exhausted_at\n       FROM connect_contact_candidates c`,
  "claimed candidate retry state select"
);

protocol = replaceOnce(
  protocol,
  `    const failure = ["TEMPORARY", "UNKNOWN", "NETWORK_BLOCKED"].includes(status);\n    const failures = failure ? Number(candidate.consecutive_failures ?? 0) + 1 : 0;\n    const delayMinutes = nextProbeDelayMinutes(status, failures);\n    const durationMs = Math.max(0, Math.min(300_000, Number(input.durationMs ?? 0) || 0));`,
  `    const failure = ["TEMPORARY", "UNKNOWN", "NETWORK_BLOCKED"].includes(status);\n    const failures = failure ? Number(candidate.consecutive_failures ?? 0) + 1 : 0;\n    const delayMinutes = nextProbeDelayMinutes(status, failures);\n    const priorCandidateRetryCount = Math.max(0, Number(candidate.mailbox_retry_count ?? 0) || 0);\n    const candidateRetryCount = failure ? priorCandidateRetryCount + 1 : priorCandidateRetryCount;\n    const candidateRetryLimit = ["UNKNOWN", "NETWORK_BLOCKED"].includes(status) ? 5 : 6;\n    const candidateRetryExhausted = failure && candidateRetryCount >= candidateRetryLimit;\n    const candidateRetryDelayMinutes = failure ? nextProbeDelayMinutes(status, candidateRetryCount) : 0;\n    const durationMs = Math.max(0, Math.min(300_000, Number(input.durationMs ?? 0) || 0));`,
  "candidate retry accounting"
);

protocol = replaceOnce(
  protocol,
  `    await client.query(\n      \`INSERT INTO connect_email_verification_cache`,
  `    await client.query(\n      \`UPDATE connect_contact_candidates\n       SET mailbox_retry_count=$2,\n           mailbox_last_status=$3,\n           mailbox_next_retry_at=CASE\n             WHEN $4 THEN NULL\n             WHEN $5 THEN now()+($6*interval '1 minute')\n             ELSE NULL\n           END,\n           mailbox_retry_exhausted_at=CASE\n             WHEN $4 THEN coalesce(mailbox_retry_exhausted_at,now())\n             ELSE NULL\n           END\n       WHERE id=$1\`,\n      [candidate.id,candidateRetryCount,status,candidateRetryExhausted,failure,candidateRetryDelayMinutes]\n    );\n\n    await client.query(\n      \`INSERT INTO connect_email_verification_cache`,
  "persist candidate retry state"
);

protocol = replaceOnce(
  protocol,
  `      promoted,\n      draftsCreated,`,
  `      promoted,\n      mailboxRetryCount:candidateRetryCount,\n      mailboxRetryLimit:candidateRetryLimit,\n      mailboxRetryExhausted:candidateRetryExhausted,\n      draftsCreated,`,
  "result retry observability"
);

fs.writeFileSync(protocolPath, protocol);

const legacyPath = "lib/connect-mailbox-verifier.ts";
let legacy = fs.readFileSync(legacyPath, "utf8");
legacy = replaceOnce(
  legacy,
  `       AND c.email_status IN ('MX_VALID','TEMPORARY')`,
  `       AND c.email_status='MX_VALID'`,
  "legacy verifier fresh-only ownership"
);
fs.writeFileSync(legacyPath, legacy);

console.log("Patched mailbox candidate retry state and ownership guards.");
