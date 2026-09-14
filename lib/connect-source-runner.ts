import { getPool } from "@/lib/db";
import { scoreConnectProspect, type ConnectIcpProfile } from "@/lib/connect-prospect-scoring";
import { apolloConfigured, sourceFromApollo } from "@/lib/connect-apollo-source";

type Candidate = {
  company_name?: string; website?: string; domain?: string; industry?: string; city?: string; state?: string; country?: string;
  employee_count?: number | null; location_count?: number | null; facility_type?: string; contact_name?: string; contact_title?: string;
  contact_email?: string; source?: string; source_url?: string; buying_signals?: string[];
};

type SourcingProfile = {
  id?: string | null;
  name?: string | null;
  service_vertical?: string | null;
  target_industries?: string[] | null;
  target_geographies?: string[] | null;
  min_employees?: number | null;
  max_employees?: number | null;
  min_locations?: number | null;
  max_locations?: number | null;
  facility_types?: string[] | null;
  decision_maker_titles?: string[] | null;
  buying_signals?: string[] | null;
  exclusions?: string[] | null;
  minimum_score?: number | null;
};

function cleanDomain(value?: string | null) {
  if (!value) return null;
  try { return new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return value.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || null; }
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.map(String).map(v => v.trim()).filter(Boolean).slice(0, 50) : [];
}

async function scoreProspect(prospectId: string) {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT p.*,
    CASE WHEN p.segment_id IS NOT NULL THEN seg.target_industries ELSE i.target_industries END AS target_industries,
    CASE WHEN p.segment_id IS NOT NULL THEN seg.target_geographies ELSE i.target_geographies END AS target_geographies,
    CASE WHEN p.segment_id IS NOT NULL THEN seg.min_employees ELSE i.min_employees END AS min_employees,
    CASE WHEN p.segment_id IS NOT NULL THEN seg.max_employees ELSE i.max_employees END AS max_employees,
    CASE WHEN p.segment_id IS NOT NULL THEN seg.min_locations ELSE i.min_locations END AS min_locations,
    CASE WHEN p.segment_id IS NOT NULL THEN seg.max_locations ELSE i.max_locations END AS max_locations,
    CASE WHEN p.segment_id IS NOT NULL THEN seg.facility_types ELSE i.facility_types END AS facility_types,
    CASE WHEN p.segment_id IS NOT NULL THEN seg.decision_maker_titles ELSE i.decision_maker_titles END AS decision_maker_titles,
    CASE WHEN p.segment_id IS NOT NULL THEN seg.buying_signals ELSE i.buying_signals END AS icp_buying_signals,
    CASE WHEN p.segment_id IS NOT NULL THEN seg.exclusions ELSE i.exclusions END AS exclusions,
    CASE WHEN p.segment_id IS NOT NULL THEN seg.minimum_score ELSE i.minimum_score END AS minimum_score,
    EXISTS (SELECT 1 FROM connect_suppressions s WHERE (s.client_id IS NULL OR s.client_id=p.client_id) AND ((s.email IS NOT NULL AND lower(s.email)=lower(p.contact_email)) OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain)))) AS is_suppressed
    FROM connect_prospects p
    JOIN connect_icp_profiles i ON i.client_id=p.client_id
    LEFT JOIN connect_prospect_segments seg ON seg.id=p.segment_id AND seg.client_id=p.client_id
    WHERE p.id=$1`, [prospectId]);
  const row = rows[0];
  if (!row) return false;
  const suppression = row.is_suppressed ? "DO_NOT_CONTACT" : row.suppression_status;
  const scoring = scoreConnectProspect({ company_name:row.company_name,domain:row.domain,industry:row.industry,city:row.city,state:row.state,country:row.country,employee_count:row.employee_count,location_count:row.location_count,facility_type:row.facility_type,contact_title:row.contact_title,buying_signals:row.buying_signals,suppression_status:suppression }, {
    target_industries:row.target_industries??[],target_geographies:row.target_geographies??[],min_employees:row.min_employees,max_employees:row.max_employees,min_locations:row.min_locations,max_locations:row.max_locations,facility_types:row.facility_types??[],decision_maker_titles:row.decision_maker_titles??[],buying_signals:row.icp_buying_signals??[],exclusions:row.exclusions??[],minimum_score:row.minimum_score??70
  } satisfies ConnectIcpProfile);
  const outreach = scoring.status === "QUALIFIED" && row.contact_email ? "READY" : "NOT_READY";
  await pool.query(`UPDATE connect_prospects SET qualification_score=$2,qualification_status=$3,qualification_reasons=$4::jsonb,suppression_status=$5,outreach_status=$6,last_scored_at=now(),updated_at=now() WHERE id=$1`, [prospectId,scoring.score,scoring.status,JSON.stringify(scoring.reasons),suppression,outreach]);
  return scoring.status === "QUALIFIED";
}

function genericConfigured() {
  return Boolean(process.env.PROSPECT_SOURCE_API_URL?.trim());
}

export function sourcingProvider() {
  if (apolloConfigured()) return "APOLLO";
  if (genericConfigured()) return "EXTERNAL";
  return "NONE";
}

export function sourcingConfigured() {
  return sourcingProvider() !== "NONE";
}

async function sourceFromGeneric(payload: Record<string, unknown>) {
  const endpoint = process.env.PROSPECT_SOURCE_API_URL?.trim();
  if (!endpoint) return [] as Candidate[];
  const headers: Record<string,string> = { "content-type":"application/json" };
  const key = process.env.PROSPECT_SOURCE_API_KEY?.trim();
  if (key) headers.authorization = `Bearer ${key}`;
  const response = await fetch(endpoint,{method:"POST",headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error(`Source provider returned ${response.status}`);
  const json = await response.json() as { prospects?: Candidate[] };
  return Array.isArray(json.prospects) ? json.prospects.slice(0,100) : [];
}

function asIcp(profile: SourcingProfile) {
  return {
    target_industries: profile.target_industries ?? [],
    target_geographies: profile.target_geographies ?? [],
    min_employees: profile.min_employees ?? null,
    max_employees: profile.max_employees ?? null,
    min_locations: profile.min_locations ?? null,
    max_locations: profile.max_locations ?? null,
    facility_types: profile.facility_types ?? [],
    decision_maker_titles: profile.decision_maker_titles ?? [],
    buying_signals: profile.buying_signals ?? [],
    exclusions: profile.exclusions ?? [],
    limit: 50
  };
}

export async function runConnectSourcing(clientId: string, segmentId?: string | null) {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT c.id,c.company_name,c.industry,c.service_area,i.* FROM connect_clients c JOIN connect_icp_profiles i ON i.client_id=c.id WHERE c.id=$1`, [clientId]);
  const client = rows[0] as SourcingProfile & { id: string; company_name: string; industry?: string | null; service_area?: string | null } | undefined;
  if (!client) throw new Error("Client ICP not found.");

  let profile: SourcingProfile = client;
  let segment: (SourcingProfile & { id: string; name: string; service_vertical: string; status: string }) | null = null;
  if (segmentId) {
    const segmentResult = await pool.query(`SELECT * FROM connect_prospect_segments WHERE id=$1 AND client_id=$2 AND status IN ('APPROVED','ACTIVE') LIMIT 1`, [segmentId, clientId]);
    segment = segmentResult.rows[0] ?? null;
    if (!segment) throw new Error("Prospect segment is not approved for sourcing.");
    profile = segment;
  }

  const icp = asIcp(profile);
  const payload = {
    client:{ id:client.id,company_name:client.company_name,industry:client.industry,service_area:client.service_area },
    segment: segment ? { id:segment.id,name:segment.name,service_vertical:segment.service_vertical } : null,
    icp
  };
  const provider = sourcingProvider();
  const run = await pool.query(`INSERT INTO connect_sourcing_runs(client_id,segment_id,provider,status,request_payload,started_at) VALUES($1,$2,$3,$4,$5::jsonb,now()) RETURNING id`, [clientId,segment?.id ?? null,provider, provider === "NONE" ? "NEEDS_PROVIDER" : "RUNNING", JSON.stringify(payload)]);
  const runId = run.rows[0].id as string;
  if (provider === "NONE") return { runId, status:"NEEDS_PROVIDER", inserted:0, qualified:0 };
  try {
    const candidates: Candidate[] = provider === "APOLLO"
      ? await sourceFromApollo(icp)
      : await sourceFromGeneric(payload);
    let inserted=0, duplicates=0, qualified=0;
    for (const c of candidates) {
      const company = String(c.company_name||"").trim().slice(0,180);
      if (!company) continue;
      const domain = cleanDomain(c.domain || c.website);
      const email = c.contact_email ? String(c.contact_email).trim().toLowerCase().slice(0,200) : null;
      const dup = await pool.query(`SELECT 1 FROM connect_prospects WHERE client_id=$1 AND (($2::text IS NOT NULL AND lower(domain)=lower($2)) OR ($3::text IS NOT NULL AND lower(contact_email)=lower($3)) OR (lower(company_name)=lower($4) AND coalesce(lower(city),'')=coalesce(lower($5),''))) LIMIT 1`, [clientId,domain,email,company,c.city||null]);
      if (dup.rowCount) { duplicates++; continue; }
      const saved = await pool.query(`INSERT INTO connect_prospects(client_id,segment_id,company_name,website,domain,industry,city,state,country,employee_count,location_count,facility_type,contact_name,contact_title,contact_email,source,source_url,buying_signals,enrichment_status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`, [clientId,segment?.id ?? null,company,c.website||null,domain,c.industry||null,c.city||null,c.state||null,c.country||'US',c.employee_count??null,c.location_count??null,c.facility_type||null,c.contact_name||null,c.contact_title||null,email,c.source||provider,c.source_url||null,strings(c.buying_signals),email ? 'ENRICHED' : 'PARTIAL']);
      inserted++;
      if (await scoreProspect(saved.rows[0].id)) qualified++;
    }
    await pool.query(`UPDATE connect_sourcing_runs SET status='COMPLETED',discovered_count=$2,inserted_count=$3,duplicate_count=$4,qualified_count=$5,completed_at=now() WHERE id=$1`, [runId,candidates.length,inserted,duplicates,qualified]);
    return { runId,status:"COMPLETED",inserted,qualified };
  } catch (error) {
    await pool.query(`UPDATE connect_sourcing_runs SET status='FAILED',error_message=$2,completed_at=now() WHERE id=$1`, [runId,error instanceof Error ? error.message.slice(0,500) : 'Unknown sourcing error']);
    throw error;
  }
}
