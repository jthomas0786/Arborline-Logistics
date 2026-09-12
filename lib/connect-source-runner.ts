import { getPool } from "@/lib/db";
import { scoreConnectProspect, type ConnectIcpProfile } from "@/lib/connect-prospect-scoring";

type Candidate = {
  company_name?: string; website?: string; domain?: string; industry?: string; city?: string; state?: string; country?: string;
  employee_count?: number | null; location_count?: number | null; facility_type?: string; contact_name?: string; contact_title?: string;
  contact_email?: string; source?: string; source_url?: string; buying_signals?: string[];
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
  const { rows } = await pool.query(`SELECT p.*,i.target_industries,i.target_geographies,i.min_employees,i.max_employees,i.min_locations,i.max_locations,i.facility_types,i.decision_maker_titles,i.buying_signals AS icp_buying_signals,i.exclusions,i.minimum_score,
    EXISTS (SELECT 1 FROM connect_suppressions s WHERE (s.client_id IS NULL OR s.client_id=p.client_id) AND ((s.email IS NOT NULL AND lower(s.email)=lower(p.contact_email)) OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain)))) AS is_suppressed
    FROM connect_prospects p JOIN connect_icp_profiles i ON i.client_id=p.client_id WHERE p.id=$1`, [prospectId]);
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

export function sourcingConfigured() {
  return Boolean(process.env.PROSPECT_SOURCE_API_URL?.trim());
}

export async function runConnectSourcing(clientId: string) {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT c.id,c.company_name,c.industry,c.service_area,i.* FROM connect_clients c JOIN connect_icp_profiles i ON i.client_id=c.id WHERE c.id=$1`, [clientId]);
  const client = rows[0];
  if (!client) throw new Error("Client ICP not found.");
  const payload = { client:{ id:client.id,company_name:client.company_name,industry:client.industry,service_area:client.service_area }, icp:{ target_industries:client.target_industries,target_geographies:client.target_geographies,min_employees:client.min_employees,max_employees:client.max_employees,min_locations:client.min_locations,max_locations:client.max_locations,facility_types:client.facility_types,decision_maker_titles:client.decision_maker_titles,buying_signals:client.buying_signals,exclusions:client.exclusions,limit:50 } };
  const run = await pool.query(`INSERT INTO connect_sourcing_runs(client_id,provider,status,request_payload,started_at) VALUES($1,'EXTERNAL',$2,$3::jsonb,now()) RETURNING id`, [clientId, sourcingConfigured() ? "RUNNING" : "NEEDS_PROVIDER", JSON.stringify(payload)]);
  const runId = run.rows[0].id as string;
  const endpoint = process.env.PROSPECT_SOURCE_API_URL?.trim();
  if (!endpoint) return { runId, status:"NEEDS_PROVIDER", inserted:0, qualified:0 };
  try {
    const headers: Record<string,string> = { "content-type":"application/json" };
    const key = process.env.PROSPECT_SOURCE_API_KEY?.trim();
    if (key) headers.authorization = `Bearer ${key}`;
    const response = await fetch(endpoint,{method:"POST",headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error(`Source provider returned ${response.status}`);
    const json = await response.json() as { prospects?: Candidate[] };
    const candidates = Array.isArray(json.prospects) ? json.prospects.slice(0,100) : [];
    let inserted=0, duplicates=0, qualified=0;
    for (const c of candidates) {
      const company = String(c.company_name||"").trim().slice(0,180);
      if (!company) continue;
      const domain = cleanDomain(c.domain || c.website);
      const email = c.contact_email ? String(c.contact_email).trim().toLowerCase().slice(0,200) : null;
      const dup = await pool.query(`SELECT 1 FROM connect_prospects WHERE client_id=$1 AND (($2::text IS NOT NULL AND lower(domain)=lower($2)) OR ($3::text IS NOT NULL AND lower(contact_email)=lower($3)) OR (lower(company_name)=lower($4) AND coalesce(lower(city),'')=coalesce(lower($5),''))) LIMIT 1`, [clientId,domain,email,company,c.city||null]);
      if (dup.rowCount) { duplicates++; continue; }
      const saved = await pool.query(`INSERT INTO connect_prospects(client_id,company_name,website,domain,industry,city,state,country,employee_count,location_count,facility_type,contact_name,contact_title,contact_email,source,source_url,buying_signals,enrichment_status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'ENRICHED') RETURNING id`, [clientId,company,c.website||null,domain,c.industry||null,c.city||null,c.state||null,c.country||'US',c.employee_count??null,c.location_count??null,c.facility_type||null,c.contact_name||null,c.contact_title||null,email,c.source||'AUTOMATED',c.source_url||null,strings(c.buying_signals)]);
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
