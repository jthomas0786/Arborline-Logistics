from pathlib import Path

DRAFTS = Path('lib/connect-outreach-drafts.ts')
SEND = Path('lib/connect-outreach-send.ts')
HELPER = Path('lib/connect-outreach-recipient.ts')
CI = Path('.github/workflows/ci.yml')

helper = r'''import { scoreContactTarget } from "./connect-contact-targeting";

type CandidateRecord = Record<string, unknown>;

type RankedCandidate = {
  candidateId: string | null;
  contactName: string | null;
  contactTitle: string | null;
  email: string;
  sourceKind: string;
  targetingScore: number;
  locationMatch: string;
  sourceStrength: number;
  identityConfidence: number;
  emailConfidence: number;
  verifiedAt: number;
};

function record(value: unknown): CandidateRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as CandidateRecord : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function locationRank(value: string) {
  if (value === "TARGET_CITY") return 3;
  if (value === "TARGET_STATE") return 2;
  if (value === "SINGLE_LOCATION") return 1;
  return 0;
}

function candidateSourceStrength(candidate: CandidateRecord) {
  const metadata = record(candidate.metadata);
  if (metadata.direct_published === true && metadata.identity_bound === true) return 4;
  const sourceKind = text(candidate.source_kind).toUpperCase();
  if (sourceKind === "PUBLIC_SITE" || sourceKind === "PUBLIC_PROFILE") return 3;
  if (candidate.primary_contact === true) return 2;
  return 1;
}

function rankCandidate(prospect: CandidateRecord, candidate: CandidateRecord): RankedCandidate | null {
  const email = text(candidate.email).toLowerCase();
  if (!email || !email.includes("@")) return null;

  const contactTitle = text(candidate.contact_title) || null;
  const contactName = text(candidate.contact_name) || null;
  const sourceUrl = text(candidate.source_url);
  const evidence = candidate.evidence ?? candidate.metadata ?? "";
  const sourceText = `${typeof evidence === "string" ? evidence : JSON.stringify(evidence)}\n${sourceUrl}`;
  const targeting = scoreContactTarget(contactTitle || "", sourceText, sourceUrl, {
    targetCity: text(prospect.city) || null,
    targetState: text(prospect.state) || null,
    employeeCount: number(prospect.employee_count, 0) || null,
    locationCount: number(prospect.location_count, 0) || null
  });

  const verifiedAtRaw = text(candidate.verified_at);
  const verifiedAt = verifiedAtRaw ? Date.parse(verifiedAtRaw) || 0 : 0;
  return {
    candidateId: text(candidate.id) || null,
    contactName,
    contactTitle,
    email,
    sourceKind: text(candidate.source_kind) || (candidate.primary_contact === true ? "PROSPECT_PRIMARY" : "UNKNOWN"),
    targetingScore: targeting.score,
    locationMatch: targeting.locationMatch,
    sourceStrength: candidateSourceStrength(candidate),
    identityConfidence: number(candidate.identity_confidence, candidate.primary_contact === true ? 90 : 0),
    emailConfidence: number(candidate.email_confidence, candidate.primary_contact === true ? 95 : 0),
    verifiedAt
  };
}

export function selectCanonicalOutreachRecipient(prospect: CandidateRecord) {
  const candidates: CandidateRecord[] = [];
  const rawPool = Array.isArray(prospect.verified_person_candidates) ? prospect.verified_person_candidates : [];
  for (const value of rawPool) candidates.push(record(value));

  if (prospect.top_level_contact_verified === true && text(prospect.contact_email)) {
    candidates.push({
      id: null,
      contact_name: prospect.contact_name,
      contact_title: prospect.contact_title,
      email: prospect.contact_email,
      source_url: prospect.source_url,
      evidence: prospect.source_metadata,
      source_kind: "PROSPECT_PRIMARY",
      primary_contact: true,
      identity_confidence: 90,
      email_confidence: 95,
      verified_at: prospect.updated_at
    });
  }

  const rankedByEmail = new Map<string, RankedCandidate>();
  for (const candidate of candidates) {
    const ranked = rankCandidate(prospect, candidate);
    if (!ranked) continue;
    const existing = rankedByEmail.get(ranked.email);
    if (!existing || compareRanked(ranked, existing) < 0) rankedByEmail.set(ranked.email, ranked);
  }

  const ranked = [...rankedByEmail.values()].sort(compareRanked);
  const best = ranked[0];
  if (best) {
    return {
      ...prospect,
      outreach_recipient_email: best.email,
      outreach_recipient_type: "PERSON",
      outreach_contact_name: best.contactName || text(prospect.contact_name) || null,
      outreach_contact_title: best.contactTitle || text(prospect.contact_title) || null,
      outreach_recipient_candidate_id: best.candidateId,
      outreach_recipient_targeting_score: best.targetingScore,
      outreach_recipient_location_match: best.locationMatch,
      outreach_recipient_selection_source: best.sourceKind
    };
  }

  const shared = text(prospect.shared_outreach_recipient_email).toLowerCase();
  if (shared) {
    return {
      ...prospect,
      outreach_recipient_email: shared,
      outreach_recipient_type: "SHARED_INBOX",
      outreach_contact_name: null,
      outreach_contact_title: null,
      outreach_recipient_candidate_id: null,
      outreach_recipient_targeting_score: null,
      outreach_recipient_location_match: "UNKNOWN",
      outreach_recipient_selection_source: "SHARED_INBOX"
    };
  }

  return {
    ...prospect,
    outreach_recipient_email: null,
    outreach_recipient_type: null,
    outreach_contact_name: null,
    outreach_contact_title: null,
    outreach_recipient_candidate_id: null,
    outreach_recipient_targeting_score: null,
    outreach_recipient_location_match: "UNKNOWN",
    outreach_recipient_selection_source: "NONE"
  };
}

function compareRanked(left: RankedCandidate, right: RankedCandidate) {
  if (left.targetingScore !== right.targetingScore) return right.targetingScore - left.targetingScore;
  const leftLocation = locationRank(left.locationMatch);
  const rightLocation = locationRank(right.locationMatch);
  if (leftLocation !== rightLocation) return rightLocation - leftLocation;
  if (left.sourceStrength !== right.sourceStrength) return right.sourceStrength - left.sourceStrength;
  if (left.identityConfidence !== right.identityConfidence) return right.identityConfidence - left.identityConfidence;
  if (left.emailConfidence !== right.emailConfidence) return right.emailConfidence - left.emailConfidence;
  if (left.verifiedAt !== right.verifiedAt) return right.verifiedAt - left.verifiedAt;
  return left.email.localeCompare(right.email);
}
'''

HELPER.write_text(helper)

drafts = DRAFTS.read_text()
if 'selectCanonicalOutreachRecipient' not in drafts:
    drafts = drafts.replace(
        'import { connectSamplesViewUrl } from "@/lib/connect-outreach-tracking";\n',
        'import { connectSamplesViewUrl } from "@/lib/connect-outreach-tracking";\nimport { selectCanonicalOutreachRecipient } from "@/lib/connect-outreach-recipient";\n'
    )

drafts = drafts.replace(
    '  const contactName = sharedRecipient ? "there" : String(prospect.contact_name || "there");\n',
    '  const contactName = sharedRecipient ? "there" : String(prospect.outreach_contact_name || prospect.contact_name || "there");\n'
)
drafts = drafts.replace(
    '  const title = String(prospect.contact_title || "").trim();\n',
    '  const title = String(prospect.outreach_contact_title || prospect.contact_title || "").trim();\n'
)

promote_select = '''    `SELECT p.*,c.company_name AS client_company,c.service_summary,c.booking_type,\n            pd.id AS prepared_draft_id,\n            CASE WHEN public.connect_contact_is_verified(p) THEN p.contact_email ELSE shared.email END AS outreach_recipient_email,\n            CASE WHEN public.connect_contact_is_verified(p) THEN 'PERSON' ELSE 'SHARED_INBOX' END AS outreach_recipient_type\n'''
promote_repl = '''    `SELECT p.*,c.company_name AS client_company,c.service_summary,c.booking_type,\n            pd.id AS prepared_draft_id,\n            public.connect_contact_is_verified(p) AS top_level_contact_verified,\n            people.candidates AS verified_person_candidates,\n            shared.email AS shared_outreach_recipient_email\n'''
if promote_select not in drafts:
    raise SystemExit('promote select anchor missing')
drafts = drafts.replace(promote_select, promote_repl, 1)

eligible_select = '''    `SELECT p.*,c.company_name AS client_company,c.service_summary,c.booking_type,\n            CASE WHEN public.connect_contact_is_verified(p) THEN p.contact_email ELSE shared.email END AS outreach_recipient_email,\n            CASE WHEN public.connect_contact_is_verified(p) THEN 'PERSON' ELSE 'SHARED_INBOX' END AS outreach_recipient_type\n'''
eligible_repl = '''    `SELECT p.*,c.company_name AS client_company,c.service_summary,c.booking_type,\n            public.connect_contact_is_verified(p) AS top_level_contact_verified,\n            people.candidates AS verified_person_candidates,\n            shared.email AS shared_outreach_recipient_email\n'''
if eligible_select not in drafts:
    raise SystemExit('eligible select anchor missing')
drafts = drafts.replace(eligible_select, eligible_repl, 1)

shared_anchor = '''     LEFT JOIN LATERAL (\n       SELECT cc.email\n       FROM connect_contact_candidates cc\n'''
person_pool = '''     LEFT JOIN LATERAL (\n       SELECT jsonb_agg(jsonb_build_object(\n         'id',cc.id,\n         'contact_name',cc.contact_name,\n         'contact_title',cc.contact_title,\n         'email',cc.email,\n         'identity_confidence',cc.identity_confidence,\n         'email_confidence',cc.email_confidence,\n         'source_url',cc.source_url,\n         'source_kind',cc.source_kind,\n         'evidence',cc.evidence,\n         'metadata',cc.metadata,\n         'verified_at',cc.verified_at\n       ) ORDER BY cc.identity_confidence DESC,cc.email_confidence DESC,cc.verified_at DESC,lower(cc.email)) AS candidates\n       FROM connect_contact_candidates cc\n       JOIN connect_email_verification_cache ev\n         ON ev.client_id=cc.client_id AND lower(ev.email)=lower(cc.email)\n       WHERE cc.prospect_id=p.id\n         AND cc.client_id=p.client_id\n         AND cc.email IS NOT NULL\n         AND cc.email_status='VERIFIED'\n         AND cc.verified_at IS NOT NULL\n         AND ev.smtp_status='VALID'\n         AND ev.confidence>=95\n         AND public.connect_contact_name_is_personlike(cc.contact_name)\n         AND (\n           (cc.metadata->>'recipient_type'='PERSON' AND cc.metadata->>'person_binding'='true')\n           OR (cc.metadata->>'direct_published'='true' AND cc.metadata->>'identity_bound'='true')\n         )\n         AND NOT EXISTS (\n           SELECT 1 FROM connect_suppressions ps\n           WHERE (ps.client_id IS NULL OR ps.client_id=p.client_id)\n             AND ps.email IS NOT NULL AND lower(ps.email)=lower(cc.email)\n         )\n     ) people ON true\n'''
if drafts.count(shared_anchor) != 2:
    raise SystemExit(f'expected 2 shared lateral anchors, found {drafts.count(shared_anchor)}')
drafts = drafts.replace(shared_anchor, person_pool + shared_anchor)

drafts = drafts.replace(
    '''       AND (\n         public.connect_contact_is_verified(p)\n         OR shared.email IS NOT NULL\n       )\n''',
    '''       AND (\n         public.connect_contact_is_verified(p)\n         OR people.candidates IS NOT NULL\n         OR shared.email IS NOT NULL\n       )\n''',
    1
)
drafts = drafts.replace(
    "       AND (public.connect_contact_is_verified(p) OR shared.email IS NOT NULL)\n",
    "       AND (public.connect_contact_is_verified(p) OR people.candidates IS NOT NULL OR shared.email IS NOT NULL)\n",
    1
)

loop_anchor = '''  let promoted = 0;\n  for (const prospect of rows) {\n'''
if loop_anchor not in drafts:
    raise SystemExit('promotion loop anchor missing')
drafts = drafts.replace(
    loop_anchor,
    '''  const selectedRows = rows\n    .map((prospect) => selectCanonicalOutreachRecipient(prospect))\n    .filter((prospect) => Boolean(prospect.outreach_recipient_email));\n  let promoted = 0;\n  for (const prospect of selectedRows) {\n''',
    1
)

drafts = drafts.replace(
    '''              recipient_email: prospect.outreach_recipient_email\n''',
    '''              recipient_email: prospect.outreach_recipient_email,\n              recipient_type: prospect.outreach_recipient_type,\n              recipient_candidate_id: prospect.outreach_recipient_candidate_id,\n              recipient_targeting_score: prospect.outreach_recipient_targeting_score,\n              recipient_location_match: prospect.outreach_recipient_location_match,\n              recipient_selection_source: prospect.outreach_recipient_selection_source\n''',
    1
)

drafts = drafts.replace(
    '''    eligible: rows.length,\n    preparedDraftsPromoted: promoted,\n''',
    '''    eligible: selectedRows.length,\n    preparedDraftsPromoted: promoted,\n''',
    1
)

drafts = drafts.replace(
    '''export async function previewConnectOutreachDrafts(clientId: string, limit = 25, segmentId?: string | null) {\n  const { rows } = await eligibleProspects(clientId, limit, segmentId);\n  return { dryRun: true, segmentId: segmentId ?? null, eligible: rows.length, limit: Math.max(1, Math.min(limit, 50)), draftsCreated: 0, messagesSent: 0 };\n}\n''',
    '''export async function previewConnectOutreachDrafts(clientId: string, limit = 25, segmentId?: string | null) {\n  const { rows: rawRows } = await eligibleProspects(clientId, limit, segmentId);\n  const rows = rawRows.map((prospect) => selectCanonicalOutreachRecipient(prospect)).filter((prospect) => Boolean(prospect.outreach_recipient_email));\n  return { dryRun: true, segmentId: segmentId ?? null, eligible: rows.length, limit: Math.max(1, Math.min(limit, 50)), draftsCreated: 0, messagesSent: 0 };\n}\n''',
    1
)

drafts = drafts.replace(
    '''  const promoted = await promotePreparedOutreachDrafts(clientId, limit, segmentId);\n  const pool = getPool(); const { rows } = await eligibleProspects(clientId, limit, segmentId); let generated = promoted.draftsCreated;\n''',
    '''  const promoted = await promotePreparedOutreachDrafts(clientId, limit, segmentId);\n  const pool = getPool();\n  const { rows: rawRows } = await eligibleProspects(clientId, limit, segmentId);\n  const rows = rawRows.map((prospect) => selectCanonicalOutreachRecipient(prospect)).filter((prospect) => Boolean(prospect.outreach_recipient_email));\n  let generated = promoted.draftsCreated;\n''',
    1
)

DRAFTS.write_text(drafts)

send = SEND.read_text()
person_exists = '''           OR EXISTS (\n             SELECT 1\n             FROM connect_contact_candidates cc\n             JOIN connect_email_verification_cache ev\n               ON ev.client_id=cc.client_id AND lower(ev.email)=lower(cc.email)\n             WHERE cc.prospect_id=p.id\n               AND cc.client_id=p.client_id\n               AND lower(cc.email)=lower(m.recipient_email)\n               AND cc.email_status='VERIFIED'\n               AND cc.verified_at IS NOT NULL\n               AND ev.smtp_status='VALID'\n               AND ev.confidence>=95\n               AND public.connect_contact_name_is_personlike(cc.contact_name)\n               AND (\n                 (cc.metadata->>'recipient_type'='PERSON' AND cc.metadata->>'person_binding'='true')\n                 OR (cc.metadata->>'direct_published'='true' AND cc.metadata->>'identity_bound'='true')\n               )\n           )\n'''
shared_exists_anchor = '''           OR EXISTS (\n             SELECT 1\n             FROM connect_contact_candidates cc\n             JOIN connect_email_verification_cache ev\n               ON ev.client_id=cc.client_id AND lower(ev.email)=lower(cc.email)\n             WHERE cc.prospect_id=p.id\n               AND cc.client_id=p.client_id\n               AND cc.source_kind='PUBLIC_SITE'\n               AND cc.metadata->>'recipient_type'='SHARED_INBOX'\n'''
if send.count(shared_exists_anchor) != 2:
    raise SystemExit(f'expected 2 shared sender verification anchors, found {send.count(shared_exists_anchor)}')
send = send.replace(shared_exists_anchor, person_exists + shared_exists_anchor)

suppression_anchor = '''         AND NOT EXISTS (\n           SELECT 1 FROM connect_suppressions s\n'''
one_recipient_gate = '''         AND NOT EXISTS (\n           SELECT 1 FROM connect_outreach_messages prior\n           WHERE prior.prospect_id=m.prospect_id\n             AND prior.id<>m.id\n             AND prior.status IN ('SENT','DELIVERED')\n             AND lower(prior.recipient_email)<>lower(m.recipient_email)\n         )\n'''
if send.count(suppression_anchor) < 2:
    raise SystemExit('sender suppression anchors missing')
send = send.replace(suppression_anchor, one_recipient_gate + suppression_anchor, 2)

send = send.replace(
    '`SELECT count(*)::int AS count\n       FROM connect_outreach_messages m\n',
    '`SELECT count(DISTINCT m.prospect_id)::int AS count\n       FROM connect_outreach_messages m\n',
    1
)
SEND.write_text(send)

ci = CI.read_text()
ci_anchor = '      - run: npx --yes tsx@4.20.6 .github/scripts/check_connect_geo_targeting.ts\n'
ci_step = '      - run: npx --yes tsx@4.20.6 .github/scripts/check_connect_single_recipient.ts\n'
if ci_step not in ci:
    if ci_anchor not in ci:
        raise SystemExit('CI geo targeting anchor missing')
    ci = ci.replace(ci_anchor, ci_anchor + ci_step, 1)
CI.write_text(ci)

print('canonical outreach recipient patch applied')
