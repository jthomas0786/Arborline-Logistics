from pathlib import Path

RESEARCH = Path('lib/connect-public-research.ts')
DEEP = Path('lib/connect-deep-research-workers.ts')

research = RESEARCH.read_text()

# PublicResearchResult exposes retained distinct candidates while preserving the existing primary candidate.
anchor = '''  candidate: PublicResearchCandidate | null;\n  publishedEmails: string[];\n'''
replacement = '''  candidate: PublicResearchCandidate | null;\n  candidates?: PublicResearchCandidate[];\n  publishedEmails: string[];\n'''
if anchor not in research:
    raise SystemExit('PublicResearchResult candidate anchor missing')
research = research.replace(anchor, replacement, 1)

# Add pure retention/ranking helpers after the existing text candidate selector.
anchor = '''  return best;\n}\n\nexport function publicResearchEnabled() {\n'''
helper = r'''  return best;
}

function normalizeResearchPersonName(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function retainedCandidateStrength(candidate: PublicResearchCandidate) {
  return candidate.decisionMakerConfidence + candidate.targetingScore + (candidate.publishedEmail ? 12 : 0);
}

export function retainDistinctDecisionMakerCandidates(
  primary: PublicResearchCandidate | null,
  discovered: PublicResearchCandidate[],
  limit = 6
) {
  const safeLimit = Math.max(1, Math.min(10, Math.floor(limit || 6)));
  const primaryKey = primary?.name ? normalizeResearchPersonName(primary.name) : "";
  const byPerson = new Map<string, PublicResearchCandidate>();

  for (const candidate of discovered) {
    if (!candidate?.name || !candidate?.title) continue;
    if (candidate.decisionMakerConfidence < HIGH_CONFIDENCE_THRESHOLD) continue;
    const key = normalizeResearchPersonName(candidate.name);
    if (!key || key === primaryKey) continue;
    const existing = byPerson.get(key);
    if (!existing || retainedCandidateStrength(candidate) > retainedCandidateStrength(existing)) {
      byPerson.set(key, candidate);
    }
  }

  const secondary = [...byPerson.values()]
    .sort((a, b) => retainedCandidateStrength(b) - retainedCandidateStrength(a)
      || String(a.name ?? "").localeCompare(String(b.name ?? "")));
  return primary ? [primary, ...secondary].slice(0, safeLimit) : secondary.slice(0, safeLimit);
}

export function publicResearchEnabled() {
'''
if anchor not in research:
    raise SystemExit('candidate selector return anchor missing')
research = research.replace(anchor, helper, 1)

# Preserve the current primary-candidate choice, but collect additional strong distinct people by title.
anchor = '''    const candidate = attachPublicProfileEmail(baseCandidate, emailPatternObservations);\n    const serviceFit = evaluateConnectServiceFit(segmentSlug, pages, targetIndustries);\n'''
replacement = '''    const primaryCandidate = attachPublicProfileEmail(baseCandidate, emailPatternObservations);\n    const discoveredCandidates: PublicResearchCandidate[] = [];\n    for (const title of targetTitles.slice(0, 36)) {\n      const perTitle = [\n        candidateFromStructuredData(allEvidencePages, domain, [title], targetingContext),\n        candidateFromPages(allEvidencePages, domain, [title], emailPatternObservations, targetingContext)\n      ];\n      for (const rawCandidate of perTitle) {\n        const attached = attachPublicProfileEmail(rawCandidate, emailPatternObservations);\n        if (attached) discoveredCandidates.push(attached);\n      }\n    }\n    const candidates = retainDistinctDecisionMakerCandidates(primaryCandidate, discoveredCandidates, 6);\n    const candidate = primaryCandidate ?? candidates[0] ?? null;\n    const serviceFit = evaluateConnectServiceFit(segmentSlug, pages, targetIndustries);\n'''
if anchor not in research:
    raise SystemExit('primary candidate selection anchor missing')
research = research.replace(anchor, replacement, 1)

anchor = '''      domain,\n      candidate,\n      publishedEmails,\n'''
replacement = '''      domain,\n      candidate,\n      candidates,\n      publishedEmails,\n'''
if anchor not in research:
    raise SystemExit('research result return anchor missing')
research = research.replace(anchor, replacement, 1)

# Add safe persistence for high-confidence identities. Published email remains unverified until mailbox verification.
anchor = '''}\n\nexport async function researchQualifiedProspects(clientId: string, limit = 10, segmentId?: string | null) {\n'''
persist = r'''}

export async function persistPublicResearchCandidates(
  clientId: string,
  prospectId: string,
  segmentId: string | null,
  marketId: string | null,
  result: PublicResearchResult
) {
  const pool = getPool();
  const retained = retainDistinctDecisionMakerCandidates(
    result.candidate,
    result.candidates ?? [],
    6
  ).filter((candidate) => Boolean(
    candidate.name && candidate.title && candidate.decisionMakerConfidence >= HIGH_CONFIDENCE_THRESHOLD
  ));
  if (!retained.length) return 0;

  const existingIdentityRows = await pool.query(
    `SELECT id,contact_name
     FROM connect_contact_candidates
     WHERE prospect_id=$1 AND client_id=$2 AND email IS NULL`,
    [prospectId, clientId]
  );
  const identityByName = new Map<string, string>();
  for (const row of existingIdentityRows.rows) {
    const key = normalizeResearchPersonName(row.contact_name);
    if (key && row.id) identityByName.set(key, String(row.id));
  }

  let persisted = 0;
  for (const candidate of retained) {
    const name = String(candidate.name ?? "").trim();
    const title = String(candidate.title ?? "").trim();
    if (!name || !title) continue;
    const email = String(candidate.publishedEmail ?? "").trim().toLowerCase() || null;
    const metadata = {
      recipient_type: "PERSON",
      identity_bound: true,
      person_binding: Boolean(email),
      direct_published: Boolean(email),
      mailbox_verified: false,
      research_identity_only: !email,
      retained_decision_maker: true,
      targeting_score: candidate.targetingScore,
      targeting_company_size: candidate.targetingCompanySize,
      targeting_role_function: candidate.targetingRoleFunction,
      targeting_seniority: candidate.targetingSeniority,
      targeting_location_match: candidate.targetingLocationMatch,
      targeting_reasons: candidate.targetingReasons
    };

    if (email) {
      await pool.query(
        `INSERT INTO connect_contact_candidates
           (client_id,prospect_id,segment_id,market_id,source_kind,contact_name,contact_title,email,
            identity_confidence,email_confidence,email_status,source_url,evidence,metadata,last_seen_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PUBLISHED_UNVERIFIED',$11,$12::jsonb,$13::jsonb,now())
         ON CONFLICT (prospect_id,(lower(email))) WHERE email IS NOT NULL DO UPDATE
         SET source_kind=excluded.source_kind,
             contact_name=excluded.contact_name,
             contact_title=excluded.contact_title,
             identity_confidence=GREATEST(connect_contact_candidates.identity_confidence,excluded.identity_confidence),
             email_confidence=GREATEST(connect_contact_candidates.email_confidence,excluded.email_confidence),
             email_status=CASE WHEN connect_contact_candidates.email_status='VERIFIED' THEN 'VERIFIED' ELSE 'PUBLISHED_UNVERIFIED' END,
             source_url=coalesce(excluded.source_url,connect_contact_candidates.source_url),
             evidence=excluded.evidence,
             metadata=coalesce(connect_contact_candidates.metadata,'{}'::jsonb)||excluded.metadata,
             last_seen_at=now()`,
        [clientId, prospectId, segmentId, marketId, candidate.sourceKind, name, title, email,
          candidate.decisionMakerConfidence, candidate.emailConfidence, candidate.sourceUrl,
          JSON.stringify(candidate.evidence), JSON.stringify(metadata)]
      );
      persisted++;
      continue;
    }

    const key = normalizeResearchPersonName(name);
    const existingId = identityByName.get(key);
    if (existingId) {
      await pool.query(
        `UPDATE connect_contact_candidates
         SET source_kind=$2,
             contact_name=$3,
             contact_title=$4,
             identity_confidence=GREATEST(identity_confidence,$5),
             email_confidence=GREATEST(email_confidence,$6),
             source_url=coalesce($7,source_url),
             evidence=$8::jsonb,
             metadata=coalesce(metadata,'{}'::jsonb)||$9::jsonb,
             last_seen_at=now()
         WHERE id=$1`,
        [existingId, candidate.sourceKind, name, title, candidate.decisionMakerConfidence,
          candidate.emailConfidence, candidate.sourceUrl, JSON.stringify(candidate.evidence), JSON.stringify(metadata)]
      );
    } else {
      const inserted = await pool.query(
        `INSERT INTO connect_contact_candidates
           (client_id,prospect_id,segment_id,market_id,source_kind,contact_name,contact_title,email,
            identity_confidence,email_confidence,email_status,source_url,evidence,metadata,last_seen_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,'UNKNOWN',$10,$11::jsonb,$12::jsonb,now())
         RETURNING id`,
        [clientId, prospectId, segmentId, marketId, candidate.sourceKind, name, title,
          candidate.decisionMakerConfidence, candidate.emailConfidence, candidate.sourceUrl,
          JSON.stringify(candidate.evidence), JSON.stringify(metadata)]
      );
      const insertedId = inserted.rows[0]?.id;
      if (insertedId) identityByName.set(key, String(insertedId));
    }
    persisted++;
  }
  return persisted;
}

export async function researchQualifiedProspects(clientId: string, limit = 10, segmentId?: string | null) {
'''
if anchor not in research:
    raise SystemExit('researchQualifiedProspects anchor missing')
research = research.replace(anchor, persist, 1)

# Fetch segment/market IDs so retained candidates preserve provenance.
anchor = '''    `SELECT id,domain,company_name,contact_name,contact_title,source,city,state,employee_count,location_count\n'''
replacement = '''    `SELECT id,segment_id,market_id,domain,company_name,contact_name,contact_title,source,city,state,employee_count,location_count\n'''
if anchor not in research:
    raise SystemExit('research qualified SELECT anchor missing')
research = research.replace(anchor, replacement, 1)

# Persist retained candidates and expose snapshots in research metadata.
anchor = '''    const candidate = result.candidate;\n    const checkedAt = new Date().toISOString();\n    const metadata = {\n'''
replacement = '''    const candidate = result.candidate;\n    await persistPublicResearchCandidates(\n      clientId,\n      String(row.id),\n      row.segment_id ? String(row.segment_id) : null,\n      row.market_id ? String(row.market_id) : null,\n      result\n    );\n    const checkedAt = new Date().toISOString();\n    const metadata = {\n'''
if anchor not in research:
    raise SystemExit('research metadata anchor missing')
research = research.replace(anchor, replacement, 1)

anchor = '''        decision_maker_confidence_grade: candidate?.confidenceGrade ?? "LOW",\n        decision_maker_corroborating_pages: candidate?.corroboratingPages ?? 0,\n'''
replacement = '''        decision_maker_confidence_grade: candidate?.confidenceGrade ?? "LOW",\n        decision_maker_candidates: (result.candidates ?? (candidate ? [candidate] : [])).slice(0, 6),\n        decision_maker_corroborating_pages: candidate?.corroboratingPages ?? 0,\n'''
if anchor not in research:
    raise SystemExit('public research metadata candidate anchor missing')
research = research.replace(anchor, replacement, 1)

RESEARCH.write_text(research)

# Deep research retains the same candidate pool without changing existing-contact preservation.
deep = DEEP.read_text()
anchor = '''  researchPublicCompanySite,\n  type PublicResearchCandidate,\n'''
replacement = '''  researchPublicCompanySite,\n  persistPublicResearchCandidates,\n  type PublicResearchCandidate,\n'''
if anchor not in deep:
    raise SystemExit('deep research import anchor missing')
deep = deep.replace(anchor, replacement, 1)

anchor = '''    decision_maker_proximity: candidate.proximity,\n    decision_maker_source_kind: candidate.sourceKind,\n'''
replacement = '''    decision_maker_proximity: candidate.proximity,\n    decision_maker_candidates: (result.candidates ?? [candidate]).slice(0, 6),\n    decision_maker_source_kind: candidate.sourceKind,\n'''
if anchor not in deep:
    raise SystemExit('deep publicResearchPatch anchor missing')
deep = deep.replace(anchor, replacement, 1)

anchor = '''  const candidate = result?.candidate ?? null;\n  const metadata = asObject(row.source_metadata);\n'''
replacement = '''  const candidate = result?.candidate ?? null;\n  if (result) {\n    await persistPublicResearchCandidates(\n      row.client_id,\n      row.id,\n      row.segment_id,\n      row.market_id,\n      result\n    );\n  }\n  const metadata = asObject(row.source_metadata);\n'''
if anchor not in deep:
    raise SystemExit('deep save candidate anchor missing')
deep = deep.replace(anchor, replacement, 1)

DEEP.write_text(deep)
print('multi-contact research retention patch applied')
