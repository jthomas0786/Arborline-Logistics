from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"Missing patch anchor in {path}: {old[:180]!r}")
    p.write_text(text.replace(old, new, 1))


# ---------------------------------------------------------------------------
# Native enrichment: store published shared inboxes as their own recipient type.
# Never bind them to a named person and never treat MX as mailbox verification.
# ---------------------------------------------------------------------------
path = "lib/connect-native-enrichment.ts"
replace_once(path,
'''type NativeCandidate = {
  email: string;
  sourceKind: "PUBLIC_SITE" | "PUBLIC_PROFILE" | "LEARNED_PATTERN";
  emailStatus: NativeEmailStatus;
  emailConfidence: number;
  pattern: EmailPattern | null;
  sourceUrl: string | null;
  evidence: string[];
};''',
'''type NativeCandidate = {
  email: string;
  sourceKind: "PUBLIC_SITE" | "PUBLIC_PROFILE" | "LEARNED_PATTERN";
  emailStatus: NativeEmailStatus;
  emailConfidence: number;
  pattern: EmailPattern | null;
  sourceUrl: string | null;
  evidence: string[];
  metadata: Record<string, unknown>;
};''')

replace_once(path,
'''  name: string;
  title: string | null;''',
'''  name: string | null;
  title: string | null;''')

replace_once(path,
'''      JSON.stringify({ pattern: c.pattern, native_engine_version: 1 })''',
'''      JSON.stringify({ pattern: c.pattern, native_engine_version: 2, ...c.metadata })''')

replace_once(path,
'''       AND contact_email IS NULL
       AND contact_name IS NOT NULL
       AND public.connect_contact_name_is_personlike(contact_name)
       AND domain IS NOT NULL
       AND (source <> 'ARBORLINE_DISCOVERY' OR source_metadata->'service_fit'->>'status'='MATCH')
       AND (
         coalesce(source_metadata->'native_contact_enrichment'->>'checked_at','')=''
         OR (
           EXISTS (
             SELECT 1 FROM connect_prepared_outreach_drafts pd
             WHERE pd.prospect_id=connect_prospects.id AND pd.status='PREPARED'
           )
           AND NOT EXISTS (
             SELECT 1 FROM connect_contact_candidates cc
             WHERE cc.prospect_id=connect_prospects.id
               AND lower(cc.contact_name)=lower(connect_prospects.contact_name)
           )
         )
       )''',
'''       AND contact_email IS NULL
       AND domain IS NOT NULL
       AND (
         (contact_name IS NOT NULL AND public.connect_contact_name_is_personlike(contact_name))
         OR (
           jsonb_typeof(source_metadata#>'{public_research,shared_inbox_candidates}')='array'
           AND jsonb_array_length(source_metadata#>'{public_research,shared_inbox_candidates}')>0
         )
       )
       AND (source <> 'ARBORLINE_DISCOVERY' OR source_metadata->'service_fit'->>'status'='MATCH')
       AND (
         coalesce(source_metadata->'native_contact_enrichment'->>'checked_at','')=''
         OR (
           EXISTS (
             SELECT 1 FROM connect_prepared_outreach_drafts pd
             WHERE pd.prospect_id=connect_prospects.id AND pd.status='PREPARED'
           )
           AND NOT EXISTS (
             SELECT 1 FROM connect_contact_candidates cc
             WHERE cc.prospect_id=connect_prospects.id
               AND lower(cc.contact_name)=lower(connect_prospects.contact_name)
           )
         )
         OR (
           jsonb_typeof(source_metadata#>'{public_research,shared_inbox_candidates}')='array'
           AND jsonb_array_length(source_metadata#>'{public_research,shared_inbox_candidates}')>0
           AND NOT EXISTS (
             SELECT 1 FROM connect_contact_candidates cc
             WHERE cc.prospect_id=connect_prospects.id
               AND cc.metadata->>'recipient_type'='SHARED_INBOX'
           )
         )
       )''')

replace_once(path,
'''    const name = String(row.contact_name ?? "").trim();
    if (!domain || !name) continue;

    await learnVerifiedPatterns(clientId, domain);''',
'''    const name = String(row.contact_name ?? "").trim();
    if (!domain) continue;

    await learnVerifiedPatterns(clientId, domain);''')

replace_once(path,
'''    const proposed = new Map<string, {
      sourceKind: "PUBLIC_SITE" | "PUBLIC_PROFILE" | "LEARNED_PATTERN";
      pattern: EmailPattern | null;
      baseConfidence: number;
      evidence: string[];
    }>();

    if (rawPublished && sameCompanyDomain(rawPublished, domain) && emailLooksLikeName(rawPublished, name)) {''',
'''    const proposed = new Map<string, {
      sourceKind: "PUBLIC_SITE" | "PUBLIC_PROFILE" | "LEARNED_PATTERN";
      pattern: EmailPattern | null;
      baseConfidence: number;
      evidence: string[];
      metadata: Record<string, unknown>;
    }>();

    const sharedInboxCandidates = Array.isArray(publicResearch.shared_inbox_candidates)
      ? publicResearch.shared_inbox_candidates
      : [];
    for (const rawShared of sharedInboxCandidates.slice(0, 6)) {
      const shared = asObject(rawShared);
      const email = String(shared.email ?? "").trim().toLowerCase();
      if (!email || !validEmailSyntax(email) || !sameCompanyDomain(email, domain)) continue;
      const targetingScore = Math.max(0, Math.min(100, Number(shared.score ?? 0) || 0));
      const priority = String(shared.priority ?? "LOW").toUpperCase();
      const sharedFunction = String(shared.function ?? "GENERAL").toUpperCase();
      const locationMatch = Boolean(shared.locationMatch);
      const reasons = Array.isArray(shared.reasons) ? shared.reasons.map(String).slice(0, 6) : [];
      proposed.set(email, {
        sourceKind: "PUBLIC_SITE",
        pattern: null,
        baseConfidence: Math.max(62, Math.min(84, targetingScore || 70)),
        evidence: [
          `Published company shared inbox recognized for ${sharedFunction.toLowerCase().replace(/_/g, " ")}.`,
          ...reasons
        ],
        metadata: {
          recipient_type: "SHARED_INBOX",
          shared_function: sharedFunction,
          shared_priority: priority,
          shared_location_match: locationMatch,
          shared_targeting_score: targetingScore,
          person_binding: false
        }
      });
      publishedCandidates++;
    }

    if (rawPublished && sameCompanyDomain(rawPublished, domain) && emailLooksLikeName(rawPublished, name)) {''')

# Add PERSON metadata to each person proposal shape.
for anchor in [
'''        evidence: [
          publishedSourceKind === "PUBLIC_PROFILE"''',
'''        evidence: [`Email follows ${learned.pattern}, learned from ${learned.verified_samples} verified contact${Number(learned.verified_samples) === 1 ? "" : "s"} on this company domain.`]''',
'''        evidence: ["Email is an ArborLine-generated same-domain candidate derived from the researched decision-maker name."]''',
'''          evidence: ["Email is a conservative ArborLine same-domain pattern candidate for a qualified, person-like decision-maker. Mailbox verification is still required before use."]'''
]:
    if anchor not in Path(path).read_text():
        raise SystemExit(f"Missing person proposal anchor: {anchor[:100]!r}")

replace_once(path,
'''        evidence: [
          publishedSourceKind === "PUBLIC_PROFILE"
            ? "Email is published on a public business/social profile tied to the company and matches the researched decision-maker first-name pattern."
            : "Email is published on the company website and matches the researched decision-maker name."
        ]''',
'''        evidence: [
          publishedSourceKind === "PUBLIC_PROFILE"
            ? "Email is published on a public business/social profile tied to the company and matches the researched decision-maker first-name pattern."
            : "Email is published on the company website and matches the researched decision-maker name."
        ],
        metadata: { recipient_type: "PERSON", person_binding: true }''')
replace_once(path,
'''        evidence: [`Email follows ${learned.pattern}, learned from ${learned.verified_samples} verified contact${Number(learned.verified_samples) === 1 ? "" : "s"} on this company domain.`]''',
'''        evidence: [`Email follows ${learned.pattern}, learned from ${learned.verified_samples} verified contact${Number(learned.verified_samples) === 1 ? "" : "s"} on this company domain.`],
        metadata: { recipient_type: "PERSON", person_binding: true }''')
replace_once(path,
'''        evidence: ["Email is an ArborLine-generated same-domain candidate derived from the researched decision-maker name."]''',
'''        evidence: ["Email is an ArborLine-generated same-domain candidate derived from the researched decision-maker name."],
        metadata: { recipient_type: "PERSON", person_binding: true }''')
replace_once(path,
'''          evidence: ["Email is a conservative ArborLine same-domain pattern candidate for a qualified, person-like decision-maker. Mailbox verification is still required before use."]''',
'''          evidence: ["Email is a conservative ArborLine same-domain pattern candidate for a qualified, person-like decision-maker. Mailbox verification is still required before use."],
          metadata: { recipient_type: "PERSON", person_binding: true }''')

replace_once(path,
'''        evidence: [
          ...proposal.evidence,
          mx.status === "VALID"
            ? "Company domain has valid MX records; mailbox existence is not yet verified."
            : `MX status is ${mx.status}; mailbox existence is not verified.`
        ]
      };''',
'''        evidence: [
          ...proposal.evidence,
          mx.status === "VALID"
            ? "Company domain has valid MX records; mailbox existence is not yet verified."
            : `MX status is ${mx.status}; mailbox existence is not verified.`
        ],
        metadata: proposal.metadata
      };''')

replace_once(path,
'''        mailbox_verified: false
      });
      await upsertCandidate({
        clientId,
        prospectId: String(row.id),
        segmentId: row.segment_id ? String(row.segment_id) : null,
        marketId: row.market_id ? String(row.market_id) : null,
        name,
        title: row.contact_title ? String(row.contact_title) : null,
        identityConfidence,
        candidate
      });''',
'''        mailbox_verified: false,
        recipient_type: proposal.metadata.recipient_type ?? "PERSON"
      });
      const sharedRecipient = proposal.metadata.recipient_type === "SHARED_INBOX";
      await upsertCandidate({
        clientId,
        prospectId: String(row.id),
        segmentId: row.segment_id ? String(row.segment_id) : null,
        marketId: row.market_id ? String(row.market_id) : null,
        name: sharedRecipient ? null : name,
        title: sharedRecipient ? null : (row.contact_title ? String(row.contact_title) : null),
        identityConfidence: sharedRecipient ? 0 : identityConfidence,
        candidate
      });''')

# ---------------------------------------------------------------------------
# Mailbox verifier: verify shared inboxes exactly like mailboxes, but never learn
# a person pattern or write the shared address into prospect.contact_email.
# ---------------------------------------------------------------------------
path = "lib/connect-mailbox-verifier.ts"
replace_once(path,
'''type ProbeResult = {
  status: MailboxStatus;''',
'''function isSharedInbox(candidate: Pick<CandidateRow, "metadata">) {
  return String(candidate.metadata?.recipient_type ?? "PERSON").toUpperCase() === "SHARED_INBOX";
}

type ProbeResult = {
  status: MailboxStatus;''')

replace_once(path,
'''async function learnVerifiedPattern(candidate: CandidateRow) {
  const pattern = String(candidate.metadata?.pattern ?? "").trim();''',
'''async function learnVerifiedPattern(candidate: CandidateRow) {
  if (isSharedInbox(candidate)) return;
  const pattern = String(candidate.metadata?.pattern ?? "").trim();''')

old_promote = '''async function promoteVerifiedCandidate(candidate: CandidateRow) {
  const pool = getPool();
  const verifiedAt = new Date().toISOString();
  const result = await pool.query(
    `UPDATE connect_prospects
     SET contact_email=$2,
         enrichment_status='ENRICHED',
         outreach_status='READY',
         source_metadata=coalesce(source_metadata,'{}'::jsonb)||$3::jsonb,
         updated_at=now()
     WHERE id=$1
       AND contact_email IS NULL
       AND qualification_status='QUALIFIED'
       AND suppression_status='CLEAR'
       AND contact_name IS NOT NULL
       AND public.connect_contact_name_is_personlike(contact_name)
       AND lower(domain)=lower($4)
       AND (source<>'ARBORLINE_DISCOVERY' OR source_metadata->'service_fit'->>'status'='MATCH')
       AND NOT EXISTS (
         SELECT 1 FROM connect_suppressions s
         WHERE (s.client_id IS NULL OR s.client_id=connect_prospects.client_id)
           AND ((s.email IS NOT NULL AND lower(s.email)=lower($2))
             OR (s.domain IS NOT NULL AND lower(s.domain)=lower(connect_prospects.domain)))
       )
     RETURNING id`,
    [candidate.prospect_id, candidate.email, JSON.stringify({
      contact_enrichment_provider: "ARBORLINE_NATIVE",
      email_status: "VERIFIED",
      native_mailbox_verification: {
        email: candidate.email,
        status: "VERIFIED",
        catch_all: false,
        verified_at: verifiedAt,
        method: "SMTP_RCPT_WITH_CATCH_ALL_CONTROL",
        verifier_version: 1
      },
      native_contact_enrichment: {
        checked_at: verifiedAt,
        engine_version: 1,
        best_candidate_email: candidate.email,
        best_candidate_status: "VERIFIED",
        best_candidate_confidence: 98,
        mailbox_verified: true,
        provider_fallback_recommended: false
      }
    }), candidate.domain]
  );
  return Boolean(result.rows[0]);
}'''
new_promote = '''async function promoteVerifiedCandidate(candidate: CandidateRow) {
  const pool = getPool();
  const verifiedAt = new Date().toISOString();
  if (isSharedInbox(candidate)) {
    const result = await pool.query(
      `UPDATE connect_prospects
       SET enrichment_status='ENRICHED',
           outreach_status='READY',
           source_metadata=coalesce(source_metadata,'{}'::jsonb)||$3::jsonb,
           updated_at=now()
       WHERE id=$1
         AND contact_email IS NULL
         AND qualification_status='QUALIFIED'
         AND suppression_status='CLEAR'
         AND lower(domain)=lower($4)
         AND (source<>'ARBORLINE_DISCOVERY' OR source_metadata->'service_fit'->>'status'='MATCH')
         AND NOT EXISTS (
           SELECT 1 FROM connect_suppressions s
           WHERE (s.client_id IS NULL OR s.client_id=connect_prospects.client_id)
             AND ((s.email IS NOT NULL AND lower(s.email)=lower($2))
               OR (s.domain IS NOT NULL AND lower(s.domain)=lower(connect_prospects.domain)))
         )
       RETURNING id`,
      [candidate.prospect_id, candidate.email, JSON.stringify({
        shared_outreach_recipient: {
          recipient_type: "SHARED_INBOX",
          email: candidate.email,
          function: candidate.metadata?.shared_function ?? null,
          priority: candidate.metadata?.shared_priority ?? null,
          location_match: candidate.metadata?.shared_location_match ?? false,
          targeting_score: candidate.metadata?.shared_targeting_score ?? 0,
          status: "VERIFIED",
          verified_at: verifiedAt,
          method: "SMTP_RCPT_WITH_CATCH_ALL_CONTROL",
          verifier_version: 1
        }
      }), candidate.domain]
    );
    return Boolean(result.rows[0]);
  }

  const result = await pool.query(
    `UPDATE connect_prospects
     SET contact_email=$2,
         enrichment_status='ENRICHED',
         outreach_status='READY',
         source_metadata=coalesce(source_metadata,'{}'::jsonb)||$3::jsonb,
         updated_at=now()
     WHERE id=$1
       AND contact_email IS NULL
       AND qualification_status='QUALIFIED'
       AND suppression_status='CLEAR'
       AND contact_name IS NOT NULL
       AND public.connect_contact_name_is_personlike(contact_name)
       AND lower(domain)=lower($4)
       AND (source<>'ARBORLINE_DISCOVERY' OR source_metadata->'service_fit'->>'status'='MATCH')
       AND NOT EXISTS (
         SELECT 1 FROM connect_suppressions s
         WHERE (s.client_id IS NULL OR s.client_id=connect_prospects.client_id)
           AND ((s.email IS NOT NULL AND lower(s.email)=lower($2))
             OR (s.domain IS NOT NULL AND lower(s.domain)=lower(connect_prospects.domain)))
       )
     RETURNING id`,
    [candidate.prospect_id, candidate.email, JSON.stringify({
      contact_enrichment_provider: "ARBORLINE_NATIVE",
      email_status: "VERIFIED",
      native_mailbox_verification: {
        email: candidate.email,
        status: "VERIFIED",
        catch_all: false,
        verified_at: verifiedAt,
        method: "SMTP_RCPT_WITH_CATCH_ALL_CONTROL",
        verifier_version: 1
      },
      native_contact_enrichment: {
        checked_at: verifiedAt,
        engine_version: 1,
        best_candidate_email: candidate.email,
        best_candidate_status: "VERIFIED",
        best_candidate_confidence: 98,
        mailbox_verified: true,
        provider_fallback_recommended: false
      }
    }), candidate.domain]
  );
  return Boolean(result.rows[0]);
}'''
replace_once(path, old_promote, new_promote)

replace_once(path,
'''       AND c.email_status IN ('MX_VALID','TEMPORARY')
       AND c.identity_confidence>=85
       AND c.email_confidence>=50
       AND v.syntax_valid=true
       AND v.mx_status='VALID'
       AND p.qualification_status='QUALIFIED'
       AND p.suppression_status='CLEAR'
       AND p.contact_email IS NULL
       AND p.contact_name IS NOT NULL
       AND public.connect_contact_name_is_personlike(p.contact_name)
       AND lower(c.contact_name)=lower(p.contact_name)
       AND p.domain IS NOT NULL''',
'''       AND c.email_status IN ('MX_VALID','TEMPORARY')
       AND c.email_confidence>=50
       AND v.syntax_valid=true
       AND v.mx_status='VALID'
       AND p.qualification_status='QUALIFIED'
       AND p.suppression_status='CLEAR'
       AND p.contact_email IS NULL
       AND (
         (
           c.metadata->>'recipient_type'='SHARED_INBOX'
           AND c.source_kind='PUBLIC_SITE'
           AND c.contact_name IS NULL
         )
         OR (
           coalesce(c.metadata->>'recipient_type','PERSON')<>'SHARED_INBOX'
           AND c.identity_confidence>=85
           AND p.contact_name IS NOT NULL
           AND public.connect_contact_name_is_personlike(p.contact_name)
           AND lower(c.contact_name)=lower(p.contact_name)
         )
       )
       AND p.domain IS NOT NULL''')

# ---------------------------------------------------------------------------
# Draft creation: select a mailbox-verified shared inbox only when no verified
# person email exists, and make the copy company-centric for that recipient.
# ---------------------------------------------------------------------------
path = "lib/connect-outreach-drafts.ts"
replace_once(path,
'''  const contactName = String(prospect.contact_name || "there");
  const firstName = contactName.split(/\s+/)[0];''',
'''  const sharedRecipient = String(prospect.outreach_recipient_type || "").toUpperCase() === "SHARED_INBOX";
  const contactName = sharedRecipient ? "there" : String(prospect.contact_name || "there");
  const firstName = contactName.split(/\s+/)[0];''')
replace_once(path,
'''    const roleLine = title ? `I saw you’re the ${title} at ${sentence(company)}` : `I came across ${sentence(company)}`;''',
'''    const roleLine = !sharedRecipient && title ? `I saw you’re the ${title} at ${sentence(company)}` : `I came across ${sentence(company)}`;''')
replace_once(path,
'''  const roleContext = title ? `Given your role as ${title} at ${sentence(company)} I thought this might be relevant.` : `${sentence(company)} It looks like it may be a fit.`;''',
'''  const roleContext = !sharedRecipient && title ? `Given your role as ${title} at ${sentence(company)} I thought this might be relevant.` : `${sentence(company)} It looks like it may be a fit.`;''')

shared_lateral = '''LEFT JOIN LATERAL (
       SELECT cc.email
       FROM connect_contact_candidates cc
       JOIN connect_email_verification_cache ev
         ON ev.client_id=cc.client_id AND lower(ev.email)=lower(cc.email)
       WHERE cc.prospect_id=p.id
         AND cc.client_id=p.client_id
         AND cc.source_kind='PUBLIC_SITE'
         AND cc.metadata->>'recipient_type'='SHARED_INBOX'
         AND cc.email_status='VERIFIED'
         AND cc.verified_at IS NOT NULL
         AND ev.smtp_status='VALID'
         AND ev.confidence>=95
       ORDER BY coalesce(nullif(cc.metadata->>'shared_targeting_score','')::int,0) DESC,
                cc.email_confidence DESC,cc.verified_at DESC
       LIMIT 1
     ) shared ON true'''

replace_once(path,
'''    `SELECT p.*,c.company_name AS client_company,c.service_summary,c.booking_type,
            pd.id AS prepared_draft_id
     FROM connect_prepared_outreach_drafts pd
     JOIN connect_prospects p ON p.id=pd.prospect_id
     JOIN connect_clients c ON c.id=p.client_id''',
'''    `SELECT p.*,c.company_name AS client_company,c.service_summary,c.booking_type,
            pd.id AS prepared_draft_id,
            CASE WHEN public.connect_contact_is_verified(p) THEN p.contact_email ELSE shared.email END AS outreach_recipient_email,
            CASE WHEN public.connect_contact_is_verified(p) THEN 'PERSON' ELSE 'SHARED_INBOX' END AS outreach_recipient_type
     FROM connect_prepared_outreach_drafts pd
     JOIN connect_prospects p ON p.id=pd.prospect_id
     JOIN connect_clients c ON c.id=p.client_id
     ''' + shared_lateral)

replace_once(path,
'''       AND p.suppression_status='CLEAR'
       AND p.contact_name IS NOT NULL
       AND public.connect_contact_name_is_personlike(p.contact_name)
       AND p.contact_email IS NOT NULL
       AND public.connect_contact_is_verified(p)
       AND NOT EXISTS (''',
'''       AND p.suppression_status='CLEAR'
       AND (
         public.connect_contact_is_verified(p)
         OR shared.email IS NOT NULL
       )
       AND NOT EXISTS (''')

replace_once(path,
'''           AND ((s.email IS NOT NULL AND lower(s.email)=lower(p.contact_email))
             OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain)))''',
'''           AND ((s.email IS NOT NULL AND lower(s.email)=lower(CASE WHEN public.connect_contact_is_verified(p) THEN p.contact_email ELSE shared.email END))
             OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain)))''')

# Only in promotePreparedOutreachDrafts, replace recipient usage before eligibleProspects section.
p = Path(path)
text = p.read_text()
head, tail = text.split('async function eligibleProspects', 1)
if 'prospect.contact_email' not in head:
    raise SystemExit('Expected promotePrepared recipient reference not found')
head = head.replace('prospect.contact_email,\n          subject,', 'prospect.outreach_recipient_email,\n          subject,', 1)
head = head.replace('recipient_email: prospect.contact_email', 'recipient_email: prospect.outreach_recipient_email', 1)
p.write_text(head + 'async function eligibleProspects' + tail)

# Replace eligibleProspects query with shared-recipient-aware query.
old_eligible = '''    `SELECT p.*,c.company_name AS client_company,c.service_summary,c.booking_type
     FROM connect_prospects p
     JOIN connect_clients c ON c.id=p.client_id
     WHERE p.client_id=$1
       AND (($3::uuid IS NULL AND p.segment_id IS NULL) OR p.segment_id=$3)
       AND p.qualification_status='QUALIFIED'
       AND (p.source <> 'ARBORLINE_DISCOVERY' OR p.source_metadata->'service_fit'->>'status'='MATCH')
       AND p.outreach_status='READY'
       AND p.suppression_status='CLEAR'
       AND p.contact_name IS NOT NULL
       AND public.connect_contact_name_is_personlike(p.contact_name)
       AND p.contact_email IS NOT NULL
       AND public.connect_contact_is_verified(p)
       AND NOT EXISTS (
         SELECT 1 FROM connect_outreach_messages m
         WHERE m.prospect_id=p.id AND m.status IN ('DRAFT','QUEUED','SENT','DELIVERED')
       )
       AND NOT EXISTS (
         SELECT 1 FROM connect_suppressions s
         WHERE (s.client_id IS NULL OR s.client_id=p.client_id)
           AND ((s.email IS NOT NULL AND lower(s.email)=lower(p.contact_email))
             OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain)))
       )
     ORDER BY p.qualification_score DESC,p.updated_at DESC
     LIMIT $2`,'''
new_eligible = '''    `SELECT p.*,c.company_name AS client_company,c.service_summary,c.booking_type,
            CASE WHEN public.connect_contact_is_verified(p) THEN p.contact_email ELSE shared.email END AS outreach_recipient_email,
            CASE WHEN public.connect_contact_is_verified(p) THEN 'PERSON' ELSE 'SHARED_INBOX' END AS outreach_recipient_type
     FROM connect_prospects p
     JOIN connect_clients c ON c.id=p.client_id
     ''' + shared_lateral + '''
     WHERE p.client_id=$1
       AND (($3::uuid IS NULL AND p.segment_id IS NULL) OR p.segment_id=$3)
       AND p.qualification_status='QUALIFIED'
       AND (p.source <> 'ARBORLINE_DISCOVERY' OR p.source_metadata->'service_fit'->>'status'='MATCH')
       AND p.outreach_status='READY'
       AND p.suppression_status='CLEAR'
       AND (public.connect_contact_is_verified(p) OR shared.email IS NOT NULL)
       AND NOT EXISTS (
         SELECT 1 FROM connect_outreach_messages m
         WHERE m.prospect_id=p.id AND m.status IN ('DRAFT','QUEUED','SENT','DELIVERED')
       )
       AND NOT EXISTS (
         SELECT 1 FROM connect_suppressions s
         WHERE (s.client_id IS NULL OR s.client_id=p.client_id)
           AND ((s.email IS NOT NULL AND lower(s.email)=lower(CASE WHEN public.connect_contact_is_verified(p) THEN p.contact_email ELSE shared.email END))
             OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain)))
       )
     ORDER BY p.qualification_score DESC,p.updated_at DESC
     LIMIT $2`,'''
replace_once(path, old_eligible, new_eligible)

# Generated message recipients use the computed recipient rather than contact_email.
replace_once(path,
'''CONNECT_FROM_EMAIL, prospect.contact_email, subject, body, experimentKey, experimentVariant, prospect.domain]);''',
'''CONNECT_FROM_EMAIL, prospect.outreach_recipient_email, subject, body, experimentKey, experimentVariant, prospect.domain]);''')

# ---------------------------------------------------------------------------
# Final send gate: a queued shared recipient must independently be VERIFIED and
# have SMTP VALID confidence >=95. Suppressions apply to the actual recipient.
# ---------------------------------------------------------------------------
path = "lib/connect-outreach-send.ts"
old_gate = '''         AND p.suppression_status='CLEAR'
         AND p.contact_email IS NOT NULL
         AND lower(p.contact_email)=lower(m.recipient_email)
         AND public.connect_contact_is_verified(p)
         AND NOT EXISTS (
           SELECT 1 FROM connect_suppressions s
           WHERE (s.client_id IS NULL OR s.client_id=p.client_id)
             AND ((s.email IS NOT NULL AND lower(s.email)=lower(p.contact_email))
               OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain)))
         )'''
new_gate = '''         AND p.suppression_status='CLEAR'
         AND (
           (
             p.contact_email IS NOT NULL
             AND lower(p.contact_email)=lower(m.recipient_email)
             AND public.connect_contact_is_verified(p)
           )
           OR EXISTS (
             SELECT 1
             FROM connect_contact_candidates cc
             JOIN connect_email_verification_cache ev
               ON ev.client_id=cc.client_id AND lower(ev.email)=lower(cc.email)
             WHERE cc.prospect_id=p.id
               AND cc.client_id=p.client_id
               AND cc.source_kind='PUBLIC_SITE'
               AND cc.metadata->>'recipient_type'='SHARED_INBOX'
               AND lower(cc.email)=lower(m.recipient_email)
               AND cc.email_status='VERIFIED'
               AND cc.verified_at IS NOT NULL
               AND ev.smtp_status='VALID'
               AND ev.confidence>=95
           )
         )
         AND NOT EXISTS (
           SELECT 1 FROM connect_suppressions s
           WHERE (s.client_id IS NULL OR s.client_id=p.client_id)
             AND ((s.email IS NOT NULL AND lower(s.email)=lower(m.recipient_email))
               OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain)))
         )'''
text = Path(path).read_text()
if text.count(old_gate) != 2:
    raise SystemExit(f"Expected two send-gate anchors, found {text.count(old_gate)}")
Path(path).write_text(text.replace(old_gate, new_gate))

print("Shared inbox recipients are wired through discovery, mailbox verification, drafting, and the final send gate.")
