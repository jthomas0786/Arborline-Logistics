from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing marker: {label}")
    return text.replace(old, new, 1)


# --- Research worker -------------------------------------------------------
research_path = Path("lib/connect-public-research.ts")
text = research_path.read_text()
text = replace_once(
    text,
    'import { scoreConnectProspect, type ConnectIcpProfile } from "@/lib/connect-prospect-scoring";\n',
    'import { scoreConnectProspect, type ConnectIcpProfile } from "@/lib/connect-prospect-scoring";\nimport { evaluateConnectServiceFit, type ConnectServiceFitResult } from "@/lib/connect-service-fit";\n',
    "research service-fit import",
)
text = replace_once(
    text,
    '  robotsRespected: boolean;\n  error?: string;\n};',
    '  robotsRespected: boolean;\n  serviceFit?: ConnectServiceFitResult;\n  error?: string;\n};',
    "research result type",
)
text = replace_once(
    text,
    'export async function researchPublicCompanySite(domainValue: string, approvedTitles: string[]): Promise<PublicResearchResult> {',
    'export async function researchPublicCompanySite(\n  domainValue: string,\n  approvedTitles: string[],\n  segmentSlug?: string | null,\n  targetIndustries: string[] = []\n): Promise<PublicResearchResult> {',
    "research function signature",
)
text = replace_once(
    text,
    '    const publishedEmails = [...new Set(pages.flatMap((page) => extractEmails(page.html, domain)))];\n    const candidate = candidateFromPages(pages, domain, approvedTitles);\n    return {\n      status: candidate ? "CANDIDATE_FOUND" : "NO_MATCH",\n      domain,\n      candidate,\n      publishedEmails,\n      pagesChecked: pages.map((page) => page.url),\n      robotsRespected: true\n    };',
    '    const publishedEmails = [...new Set(pages.flatMap((page) => extractEmails(page.html, domain)))];\n    const candidate = candidateFromPages(pages, domain, approvedTitles);\n    const serviceFit = evaluateConnectServiceFit(segmentSlug, pages, targetIndustries);\n    return {\n      status: candidate ? "CANDIDATE_FOUND" : "NO_MATCH",\n      domain,\n      candidate,\n      publishedEmails,\n      pagesChecked: pages.map((page) => page.url),\n      robotsRespected: true,\n      serviceFit\n    };',
    "research service-fit evaluation",
)
text = replace_once(
    text,
    '`SELECT id,domain,company_name,contact_name,contact_title\n     FROM connect_prospects',
    '`SELECT id,domain,company_name,contact_name,contact_title,source\n     FROM connect_prospects',
    "research source select",
)
old_status = '''       AND (
         qualification_status='QUALIFIED'
         OR (
           qualification_status='REVIEW'
           AND coalesce(qualification_score,0) >= 60
           AND source='ARBORLINE_DISCOVERY'
         )
       )'''
new_status = '''       AND (
         qualification_status='QUALIFIED'
         OR (
           qualification_status='REVIEW'
           AND coalesce(qualification_score,0) >= 60
           AND source='ARBORLINE_DISCOVERY'
         )
         OR (
           source='ARBORLINE_DISCOVERY'
           AND coalesce(source_metadata->'service_fit'->>'status','')=''
         )
       )'''
text = replace_once(text, old_status, new_status, "research service-fit eligibility")
text = replace_once(
    text,
    "       AND NOT (coalesce(source_metadata,'{}'::jsonb) ? 'public_research_checked_at')",
    """       AND (
         NOT (coalesce(source_metadata,'{}'::jsonb) ? 'public_research_checked_at')
         OR (
           source='ARBORLINE_DISCOVERY'
           AND coalesce(source_metadata->'service_fit'->>'status','')=''
         )
       )""",
    "research service-fit backlog check",
)
text = replace_once(
    text,
    '    const result = await researchPublicCompanySite(String(row.domain), titles);',
    '    const result = await researchPublicCompanySite(\n      String(row.domain),\n      titles,\n      segmentId ? String(profile.rows[0]?.slug ?? "") : null,\n      segmentId && Array.isArray(profile.rows[0]?.target_industries) ? profile.rows[0].target_industries.map(String) : []\n    );',
    "research service-fit call",
)
text = replace_once(
    text,
    '    const metadata = {\n      public_research_checked_at: new Date().toISOString(),\n      public_research: {',
    '''    const checkedAt = new Date().toISOString();
    const metadata = {
      public_research_checked_at: checkedAt,
      service_fit_checked_at: checkedAt,
      service_fit: result.serviceFit ?? {
        status: "UNVERIFIED",
        matchedTerms: [],
        commercialSignals: [],
        mismatchSignals: [],
        pagesMatched: [],
        evidence: ["Service fit was not available for this research result."]
      },
      public_research: {''',
    "research metadata service-fit",
)
text = replace_once(
    text,
    '''       SET contact_name=CASE WHEN contact_name IS NULL AND $2::text IS NOT NULL AND $4::int >= $6::int THEN $2 ELSE contact_name END,
           contact_title=CASE WHEN contact_title IS NULL AND $3::text IS NOT NULL AND $4::int >= $6::int THEN $3 ELSE contact_title END,''',
    '''       SET contact_name=CASE WHEN contact_name IS NULL AND $2::text IS NOT NULL AND $4::int >= $6::int AND $7::boolean THEN $2 ELSE contact_name END,
           contact_title=CASE WHEN contact_title IS NULL AND $3::text IS NOT NULL AND $4::int >= $6::int AND $7::boolean THEN $3 ELSE contact_title END,''',
    "research service-fit contact persistence",
)
text = replace_once(
    text,
    '[row.id, candidate?.name ?? null, candidate?.title ?? null, candidate?.decisionMakerConfidence ?? 0, JSON.stringify(metadata), HIGH_CONFIDENCE_THRESHOLD]\n    );',
    '[row.id, candidate?.name ?? null, candidate?.title ?? null, candidate?.decisionMakerConfidence ?? 0, JSON.stringify(metadata), HIGH_CONFIDENCE_THRESHOLD, row.source !== "ARBORLINE_DISCOVERY" || result.serviceFit?.status === "MATCH"]\n    );',
    "research contact persistence args",
)
text = replace_once(
    text,
    '          industry: current.industry,\n          city: current.city,',
    '          industry: current.industry,\n          industry_fit_status: current.source === "ARBORLINE_DISCOVERY" ? (result.serviceFit?.status ?? "UNVERIFIED") : null,\n          city: current.city,',
    "research score service-fit",
)
research_path.write_text(text)


# --- OSM discovery ---------------------------------------------------------
discovery_path = Path("lib/connect-public-discovery.ts")
text = discovery_path.read_text()
text = replace_once(
    text,
    'import { researchPublicCompanySite } from "@/lib/connect-public-research";\n',
    'import { researchPublicCompanySite } from "@/lib/connect-public-research";\nimport { normalizeConnectServiceFitStatus } from "@/lib/connect-service-fit";\n',
    "discovery service-fit import",
)
text = replace_once(
    text,
    '    industry: row.industry,\n    city: row.city,',
    '    industry: row.industry,\n    industry_fit_status: row.source === "ARBORLINE_DISCOVERY" ? normalizeConnectServiceFitStatus(row.source_metadata?.service_fit?.status) : null,\n    city: row.city,',
    "discovery score service-fit",
)
text = replace_once(
    text,
    '  const result = await researchPublicCompanySite(String(prospect.domain), titles);\n  const candidate = result.candidate;\n  const highConfidence = Boolean(candidate && candidate.decisionMakerConfidence >= HIGH_CONFIDENCE_THRESHOLD && candidate.confidenceGrade === "HIGH");',
    '  const result = await researchPublicCompanySite(String(prospect.domain), titles, segment.slug, segment.target_industries ?? []);\n  const candidate = result.candidate;\n  const highConfidence = Boolean(result.serviceFit?.status === "MATCH" && candidate && candidate.decisionMakerConfidence >= HIGH_CONFIDENCE_THRESHOLD && candidate.confidenceGrade === "HIGH");',
    "discovery research service-fit call",
)
text = replace_once(
    text,
    '  const metadata = {\n    public_research_checked_at: new Date().toISOString(),\n    public_research: {',
    '''  const checkedAt = new Date().toISOString();
  const metadata = {
    public_research_checked_at: checkedAt,
    service_fit_checked_at: checkedAt,
    service_fit: result.serviceFit ?? {
      status: "UNVERIFIED",
      matchedTerms: [],
      commercialSignals: [],
      mismatchSignals: [],
      pagesMatched: [],
      evidence: ["Service fit was not available for this research result."]
    },
    public_research: {''',
    "discovery service-fit metadata",
)
discovery_path.write_text(text)


# --- Overture ingestion ----------------------------------------------------
overture_path = Path("lib/connect-overture-ingest.ts")
text = overture_path.read_text()
text = replace_once(
    text,
    'import { scoreConnectProspect, type ConnectIcpProfile } from "@/lib/connect-prospect-scoring";\n',
    'import { scoreConnectProspect, type ConnectIcpProfile } from "@/lib/connect-prospect-scoring";\nimport { normalizeConnectServiceFitStatus } from "@/lib/connect-service-fit";\n',
    "overture service-fit import",
)
text = replace_once(
    text,
    '    industry: row.industry,\n    city: row.city,',
    '    industry: row.industry,\n    industry_fit_status: row.source === "ARBORLINE_DISCOVERY" ? normalizeConnectServiceFitStatus(row.source_metadata?.service_fit?.status) : null,\n    city: row.city,',
    "overture score service-fit",
)
overture_path.write_text(text)


# --- Research queue + promotion guard ------------------------------------
route_path = Path("app/api/cron/connect-research/route.ts")
text = route_path.read_text()
old_route_status = '''        AND (
          p.qualification_status='QUALIFIED'
          OR (
            p.qualification_status='REVIEW'
            AND coalesce(p.qualification_score,0) >= 60
            AND p.source='ARBORLINE_DISCOVERY'
          )
        )'''
new_route_status = '''        AND (
          p.qualification_status='QUALIFIED'
          OR (
            p.qualification_status='REVIEW'
            AND coalesce(p.qualification_score,0) >= 60
            AND p.source='ARBORLINE_DISCOVERY'
          )
          OR (
            p.source='ARBORLINE_DISCOVERY'
            AND coalesce(p.source_metadata->'service_fit'->>'status','')=''
          )
        )'''
if text.count(old_route_status) != 1:
    raise SystemExit(f"expected one indented route eligibility block, found {text.count(old_route_status)}")
text = text.replace(old_route_status, new_route_status, 1)
old_route_status_2 = '''      AND (
        p.qualification_status='QUALIFIED'
        OR (
          p.qualification_status='REVIEW'
          AND coalesce(p.qualification_score,0) >= 60
          AND p.source='ARBORLINE_DISCOVERY'
        )
      )'''
new_route_status_2 = '''      AND (
        p.qualification_status='QUALIFIED'
        OR (
          p.qualification_status='REVIEW'
          AND coalesce(p.qualification_score,0) >= 60
          AND p.source='ARBORLINE_DISCOVERY'
        )
        OR (
          p.source='ARBORLINE_DISCOVERY'
          AND coalesce(p.source_metadata->'service_fit'->>'status','')=''
        )
      )'''
text = replace_once(text, old_route_status_2, new_route_status_2, "route default service-fit eligibility")
old_checked = "        AND NOT (coalesce(p.source_metadata,'{}'::jsonb) ? 'public_research_checked_at')"
new_checked = '''        AND (
          NOT (coalesce(p.source_metadata,'{}'::jsonb) ? 'public_research_checked_at')
          OR (
            p.source='ARBORLINE_DISCOVERY'
            AND coalesce(p.source_metadata->'service_fit'->>'status','')=''
          )
        )'''
text = replace_once(text, old_checked, new_checked, "route requested checked marker")
old_checked_2 = "      AND NOT (coalesce(p.source_metadata,'{}'::jsonb) ? 'public_research_checked_at')"
new_checked_2 = '''      AND (
        NOT (coalesce(p.source_metadata,'{}'::jsonb) ? 'public_research_checked_at')
        OR (
          p.source='ARBORLINE_DISCOVERY'
          AND coalesce(p.source_metadata->'service_fit'->>'status','')=''
        )
      )'''
text = replace_once(text, old_checked_2, new_checked_2, "route default checked marker")

# Defense in depth: even a future scoring regression cannot promote a self-discovered
# contact unless company-site service verification says MATCH.
promotion_marker = "       AND p.qualification_status='QUALIFIED'\n       AND p.suppression_status='CLEAR'"
promotion_replacement = "       AND p.qualification_status='QUALIFIED'\n       AND (p.source <> 'ARBORLINE_DISCOVERY' OR p.source_metadata->'service_fit'->>'status'='MATCH')\n       AND p.suppression_status='CLEAR'"
if text.count(promotion_marker) != 2:
    raise SystemExit(f"expected two promotion qualification markers, found {text.count(promotion_marker)}")
text = text.replace(promotion_marker, promotion_replacement)
route_path.write_text(text)
