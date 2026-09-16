from pathlib import Path

research = Path("lib/connect-public-research.ts")
text = research.read_text()

old_import = 'import { getPool } from "@/lib/db";\n'
new_import = 'import { getPool } from "@/lib/db";\nimport { scoreConnectProspect, type ConnectIcpProfile } from "@/lib/connect-prospect-scoring";\n'
if 'connect-prospect-scoring' not in text:
    if old_import not in text:
        raise SystemExit("research import marker missing")
    text = text.replace(old_import, new_import, 1)

old_profile = """      `SELECT decision_maker_titles FROM connect_prospect_segments
       WHERE id=$1 AND client_id=$2 AND status IN ('APPROVED','ACTIVE') LIMIT 1`,"""
new_profile = """      `SELECT * FROM connect_prospect_segments
       WHERE id=$1 AND client_id=$2 AND status IN ('APPROVED','ACTIVE') LIMIT 1`,"""
if old_profile not in text:
    raise SystemExit("segment profile marker missing")
text = text.replace(old_profile, new_profile, 1)

old_select = """    `SELECT id,domain,company_name,contact_name,contact_title
     FROM connect_prospects
     WHERE client_id=$1
       AND (($3::uuid IS NULL AND segment_id IS NULL) OR segment_id=$3)
       AND qualification_status='QUALIFIED'
       AND contact_email IS NULL
       AND domain IS NOT NULL
       AND NOT (coalesce(source_metadata,'{}'::jsonb) ? 'public_research_checked_at')
     ORDER BY qualification_score DESC NULLS LAST,created_at ASC
     LIMIT $2`,"""
new_select = """    `SELECT id,domain,company_name,contact_name,contact_title
     FROM connect_prospects
     WHERE client_id=$1
       AND (($3::uuid IS NULL AND segment_id IS NULL) OR segment_id=$3)
       AND (
         qualification_status='QUALIFIED'
         OR (
           qualification_status='REVIEW'
           AND coalesce(qualification_score,0) >= 60
           AND source='ARBORLINE_DISCOVERY'
         )
       )
       AND contact_email IS NULL
       AND domain IS NOT NULL
       AND NOT (coalesce(source_metadata,'{}'::jsonb) ? 'public_research_checked_at')
     ORDER BY qualification_score DESC NULLS LAST,created_at ASC
     LIMIT $2`,"""
if old_select not in text:
    raise SystemExit("research candidate query marker missing")
text = text.replace(old_select, new_select, 1)

# Harden obvious non-person CTA/service tokens for the newly active verticals.
old_terms = '  "technician", "technicians", "typical", "workforce"\n]);'
new_terms = '  "technician", "technicians", "typical", "workforce", "roof", "roofer", "roofers", "roofing",\n  "pest", "plumber", "plumbers", "plumbing", "fire", "protection", "sprinkler", "sprinklers",\n  "quote", "request", "schedule", "call", "free"\n]);'
if old_terms not in text:
    raise SystemExit("non-person term marker missing")
text = text.replace(old_terms, new_terms, 1)

old_semantic = r'''  const semanticBanned = /\b(team|leadership|management|contact|about|services?|company|landscap(?:e|ing)|hvac|clean(?:er|ers|ing)?|staffing|director|manager|president|owner|founder|chief|officer|sales|operations|commercial|residential|professionals?|specialists?)\b/i;'''
new_semantic = r'''  const semanticBanned = /\b(team|leadership|management|contact|about|services?|company|landscap(?:e|ing)|hvac|clean(?:er|ers|ing)?|staffing|roof(?:er|ers|ing)?|pest|plumb(?:er|ers|ing)?|fire|protection|sprinklers?|quote|request|schedule|call|free|director|manager|president|owner|founder|chief|officer|sales|operations|commercial|residential|professionals?|specialists?)\b/i;'''
if old_semantic not in text:
    raise SystemExit("semantic person guard marker missing")
text = text.replace(old_semantic, new_semantic, 1)

old_counters = """  let blocked = 0;
  let errors = 0;
"""
new_counters = """  let blocked = 0;
  let errors = 0;
  let qualifiedAfterResearch = 0;
"""
if old_counters not in text:
    raise SystemExit("research counter marker missing")
text = text.replace(old_counters, new_counters, 1)

marker = """    await pool.query(
      `UPDATE connect_prospects
       SET contact_name=CASE WHEN contact_name IS NULL AND $2::text IS NOT NULL AND $4::int >= $6::int THEN $2 ELSE contact_name END,
           contact_title=CASE WHEN contact_title IS NULL AND $3::text IS NOT NULL AND $4::int >= $6::int THEN $3 ELSE contact_title END,
           source_metadata=coalesce(source_metadata,'{}'::jsonb) || $5::jsonb,
           updated_at=now()
       WHERE id=$1`,
      [row.id, candidate?.name ?? null, candidate?.title ?? null, candidate?.decisionMakerConfidence ?? 0, JSON.stringify(metadata), HIGH_CONFIDENCE_THRESHOLD]
    );
"""
replacement = marker + """
    // Strong self-discovered REVIEW prospects can become QUALIFIED when
    // public research adds a HIGH-confidence approved decision-maker. The
    // re-score never makes outreach send-ready; email promotion is a separate
    // safety gate in the research route.
    if (segmentId && profile.rows[0]) {
      const currentResult = await pool.query(
        `SELECT p.*, EXISTS (
           SELECT 1 FROM connect_suppressions s
           WHERE (s.client_id IS NULL OR s.client_id=p.client_id)
             AND ((s.email IS NOT NULL AND lower(s.email)=lower(p.contact_email))
               OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain)))
         ) AS is_suppressed
         FROM connect_prospects p WHERE p.id=$1 LIMIT 1`,
        [row.id]
      );
      const current = currentResult.rows[0];
      const segment = profile.rows[0];
      if (current) {
        const suppression = current.is_suppressed ? "DO_NOT_CONTACT" : current.suppression_status;
        const segmentProfile: ConnectIcpProfile = {
          target_industries: segment.target_industries ?? [],
          target_geographies: segment.target_geographies ?? [],
          min_employees: segment.min_employees,
          max_employees: segment.max_employees,
          min_locations: segment.min_locations,
          max_locations: segment.max_locations,
          facility_types: segment.facility_types ?? [],
          decision_maker_titles: segment.decision_maker_titles ?? [],
          buying_signals: segment.buying_signals ?? [],
          exclusions: segment.exclusions ?? [],
          minimum_score: segment.minimum_score ?? 70
        };
        const scored = scoreConnectProspect({
          company_name: current.company_name,
          domain: current.domain,
          industry: current.industry,
          city: current.city,
          state: current.state,
          country: current.country,
          employee_count: current.employee_count,
          location_count: current.location_count,
          facility_type: current.facility_type,
          contact_title: current.contact_title,
          buying_signals: current.buying_signals,
          suppression_status: suppression
        }, segmentProfile);
        await pool.query(
          `UPDATE connect_prospects
           SET qualification_score=$2,qualification_status=$3,qualification_reasons=$4::jsonb,
               suppression_status=$5,outreach_status='NOT_READY',last_scored_at=now(),updated_at=now()
           WHERE id=$1`,
          [row.id, scored.score, scored.status, JSON.stringify(scored.reasons), suppression]
        );
        if (scored.status === "QUALIFIED") qualifiedAfterResearch++;
      }
    }
"""
if marker not in text:
    raise SystemExit("research update marker missing")
text = text.replace(marker, replacement, 1)

old_return = """    publishedEmailCandidates,
    blocked,
    errors,
    segmentId: segmentId ?? null,
"""
new_return = """    publishedEmailCandidates,
    blocked,
    errors,
    qualifiedAfterResearch,
    segmentId: segmentId ?? null,
"""
if old_return not in text:
    raise SystemExit("research return marker missing")
text = text.replace(old_return, new_return, 1)
research.write_text(text)

route = Path("app/api/cron/connect-research/route.ts")
route_text = route.read_text()
old_backlog = """        AND p.qualification_status='QUALIFIED'
        AND p.contact_email IS NULL"""
new_backlog = """        AND (
          p.qualification_status='QUALIFIED'
          OR (
            p.qualification_status='REVIEW'
            AND coalesce(p.qualification_score,0) >= 60
            AND p.source='ARBORLINE_DISCOVERY'
          )
        )
        AND p.contact_email IS NULL"""
if route_text.count(old_backlog) != 1:
    raise SystemExit(f"expected one requested backlog marker, found {route_text.count(old_backlog)}")
route_text = route_text.replace(old_backlog, new_backlog, 1)

old_backlog2 = """      AND p.qualification_status='QUALIFIED'
      AND p.contact_email IS NULL"""
new_backlog2 = """      AND (
        p.qualification_status='QUALIFIED'
        OR (
          p.qualification_status='REVIEW'
          AND coalesce(p.qualification_score,0) >= 60
          AND p.source='ARBORLINE_DISCOVERY'
        )
      )
      AND p.contact_email IS NULL"""
if route_text.count(old_backlog2) != 1:
    raise SystemExit(f"expected one global backlog marker, found {route_text.count(old_backlog2)}")
route_text = route_text.replace(old_backlog2, new_backlog2, 1)

old_empty_result = """        publishedEmailCandidates: 0,
        blocked: 0,
        errors: 0,
        segmentId: String(segment.id),"""
new_empty_result = """        publishedEmailCandidates: 0,
        blocked: 0,
        errors: 0,
        qualifiedAfterResearch: 0,
        segmentId: String(segment.id),"""
if old_empty_result not in route_text:
    raise SystemExit("route empty result marker missing")
route_text = route_text.replace(old_empty_result, new_empty_result, 1)
route.write_text(route_text)

discovery = Path("lib/connect-public-discovery.ts")
discovery_text = discovery.read_text()
old_limit = 'const researchLimit = clamp(process.env.CONNECT_PUBLIC_DISCOVERY_RESEARCH_LIMIT, 0, 8, 4);'
new_limit = 'const researchLimit = clamp(process.env.CONNECT_PUBLIC_DISCOVERY_RESEARCH_LIMIT, 0, 8, 0);'
if old_limit in discovery_text:
    discovery_text = discovery_text.replace(old_limit, new_limit, 1)
discovery.write_text(discovery_text)

overture = Path("scripts/connect_overture_discovery.py")
overture_text = overture.read_text()
# Final validation edge cases: schools/training centers are not roofing prospects;
# restoration/disinfection-only companies are not pest-control operators.
overture_text = overture_text.replace(
    'r"\\bacademy\\b", r"\\bschool\\b", r"\\blocal\\s+\\d+\\b"]',
    'r"\\bacademy\\b", r"\\bschool\\b", r"\\btraining center\\b", r"roofing school", r"\\blocal\\s+\\d+\\b"]',
    1,
)
old_pest = '''    if slug == "pest-control":
        if tax & SUPPLY_MANUFACTURING_TAXONOMY or "retail" in tax:
            return False
        strong_taxonomy = "pest_control_service" in tax
        return service_context and (strong_taxonomy or name_or_domain_signal)
'''
new_pest = '''    if slug == "pest-control":
        if tax & SUPPLY_MANUFACTURING_TAXONOMY or "retail" in tax or "damage_restoration" in tax:
            return False
        if "home_cleaning" in tax and not name_or_domain_signal:
            return False
        strong_taxonomy = "pest_control_service" in tax
        return service_context and (strong_taxonomy or name_or_domain_signal)
'''
if old_pest in overture_text:
    overture_text = overture_text.replace(old_pest, new_pest, 1)
overture.write_text(overture_text)
