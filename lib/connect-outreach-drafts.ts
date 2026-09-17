import { createHash, randomUUID } from "crypto";
import { getPool } from "@/lib/db";
import { connectSamplesViewUrl } from "@/lib/connect-outreach-tracking";

const CONNECT_FROM_EMAIL = "josh@mail.arborlineconnect.com";
export const CONNECT_SAMPLES_EXPERIMENT_KEY = "alc_samples_link_v1";
export type ConnectSamplesExperimentVariant = "CONTROL" | "SAMPLES_LINK";

function sentence(value: string) { const clean = value.trim(); return /[.!?]$/.test(clean) ? clean : `${clean}.`; }
function questionName(value: string) { return value.trim().replace(/[.!?]+$/, ""); }

function isArborLineOwnOutreach(prospect: Record<string, unknown>) {
  return String(prospect.client_company || "").trim().toLowerCase() === "arborline connect";
}

export function connectSamplesExperimentVariant(prospect: Record<string, unknown>): ConnectSamplesExperimentVariant | null {
  if (!isArborLineOwnOutreach(prospect)) return null;
  const stableId = String(prospect.id || prospect.prospect_id || prospect.contact_email || prospect.company_name || "").trim().toLowerCase();
  const bucket = createHash("sha256").update(`${CONNECT_SAMPLES_EXPERIMENT_KEY}:${stableId}`).digest()[0];
  return bucket % 2 === 0 ? "CONTROL" : "SAMPLES_LINK";
}

export function buildConnectOutreachDraft(prospect: Record<string, unknown>, options: { samplesUrl?: string } = {}) {
  const contactName = String(prospect.contact_name || "there");
  const firstName = contactName.split(/\s+/)[0];
  const company = String(prospect.company_name || "your company").trim();
  const companyQuestion = questionName(company) || "your company";
  const title = String(prospect.contact_title || "").trim();
  const client = String(prospect.client_company || "our client");
  if (client.toLowerCase() === "arborline connect") {
    const roleLine = title ? `I saw you’re the ${title} at ${sentence(company)}` : `I came across ${sentence(company)}`;
    const samplesLine = options.samplesUrl
      ? `\n\nIf you want a quick look first, you can request a free 3–5 company prospect sample here:\n${options.samplesUrl}`
      : "";
    return { subject: `${company} — more qualified sales conversations?`, body: `Hi ${firstName},\n\nI’m Josh Thomas, founder of ArborLine Connect. ${roleLine}\n\nI built ArborLine for recurring-service businesses that want a steadier way to find qualified B2B opportunities without spending hours building lists and chasing the wrong contacts. It finds matching companies, identifies decision-makers, qualifies the opportunity, and helps move real interest toward a sales conversation.\n\nI’m opening the first 3–5 Founding Client spots at $750/month, with no setup fee and month-to-month billing.${samplesLine}\n\nWould you be open to me sending over a quick 90-second video showing how ArborLine could work for ${companyQuestion}?\n\nIf it’s not relevant or you’d rather not hear from me, just reply “no thanks” and I’ll stop.\n\nBest,\nJosh Thomas\nFounder, ArborLine Connect` };
  }
  const serviceLine = prospect.service_summary ? String(prospect.service_summary).replace(/\s+/g, " ").slice(0, 260) : `services from ${client}`;
  const booking = String(prospect.booking_type || "CALL").toLowerCase();
  const roleContext = title ? `Given your role as ${title} at ${sentence(company)} I thought this might be relevant.` : `${sentence(company)} It looks like it may be a fit.`;
  return { subject: `${company} facilities — quick question`, body: `Hi ${firstName},\n\nI’m Josh Thomas with ArborLine Connect, reaching out on behalf of ${sentence(client)} ${roleContext}\n\n${client} provides ${sentence(serviceLine)}\n\nWould you be open to a quick ${booking} to see whether it makes sense to talk?\n\nIf this isn’t relevant or you’d rather not hear from me, just reply “no thanks” and I’ll stop.\n\nBest,\nJosh Thomas\nArborLine Connect` };
}

export function buildConnectOutreachDraftForMessage(prospect: Record<string, unknown>, messageId: string) {
  const assignedVariant = connectSamplesExperimentVariant(prospect);
  const samplesUrl = assignedVariant === "SAMPLES_LINK" ? connectSamplesViewUrl(messageId) : "";
  const experimentVariant: ConnectSamplesExperimentVariant | null = assignedVariant === "SAMPLES_LINK" && !samplesUrl
    ? "CONTROL"
    : assignedVariant;
  const draft = buildConnectOutreachDraft(prospect, { samplesUrl: experimentVariant === "SAMPLES_LINK" ? samplesUrl : "" });
  return {
    ...draft,
    experimentKey: experimentVariant ? CONNECT_SAMPLES_EXPERIMENT_KEY : null,
    experimentVariant
  };
}

async function eligibleProspects(clientId: string, limit: number, segmentId?: string | null) {
  return getPool().query(
    `SELECT p.*,c.company_name AS client_company,c.service_summary,c.booking_type
     FROM connect_prospects p
     JOIN connect_clients c ON c.id=p.client_id
     WHERE p.client_id=$1
       AND (($3::uuid IS NULL AND p.segment_id IS NULL) OR p.segment_id=$3)
       AND p.qualification_status='QUALIFIED'
       AND (p.source <> 'ARBORLINE_DISCOVERY' OR p.source_metadata->'service_fit'->>'status'='MATCH')
       AND p.outreach_status='READY'
       AND p.suppression_status='CLEAR'
       AND p.contact_email IS NOT NULL
       AND (
         (
           upper(coalesce(p.source_metadata->>'contact_enrichment_provider',''))='PROSPEO'
           AND upper(coalesce(p.source_metadata->>'email_status',''))='VERIFIED'
         )
         OR (
           upper(coalesce(p.source_metadata->>'contact_enrichment_provider',''))='HUNTER'
           AND upper(coalesce(p.source_metadata->>'email_status','')) IN ('VALID','VERIFIED')
         )
         OR (
           lower(coalesce(p.source_metadata->'hunter_verification'->>'status',''))='valid'
           AND lower(coalesce(p.source_metadata->'hunter_verification'->>'email',''))=lower(p.contact_email)
         )
         OR lower(coalesce(p.source_metadata->'hunter_email_finder'->>'verification_status','')) IN ('valid','verified')
       )
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
     LIMIT $2`,
    [clientId, Math.max(1, Math.min(limit, 50)), segmentId ?? null]
  );
}

export async function previewConnectOutreachDrafts(clientId: string, limit = 25, segmentId?: string | null) {
  const { rows } = await eligibleProspects(clientId, limit, segmentId);
  return { dryRun: true, segmentId: segmentId ?? null, eligible: rows.length, limit: Math.max(1, Math.min(limit, 50)), draftsCreated: 0, messagesSent: 0 };
}

export async function prepareConnectOutreachDrafts(clientId: string, limit = 25, segmentId?: string | null) {
  const pool = getPool(); const { rows } = await eligibleProspects(clientId, limit, segmentId); let generated = 0;
  for (const prospect of rows) {
    const messageId = randomUUID();
    const { subject, body, experimentKey, experimentVariant } = buildConnectOutreachDraftForMessage(prospect, messageId);
    const result = await pool.query(`INSERT INTO connect_outreach_messages (id,prospect_id,client_id,sender_name,sender_email,recipient_email,subject,body_text,status,experiment_key,experiment_variant) SELECT $1,$2,$3,'Josh Thomas',$4,$5,$6,$7,'DRAFT',$8,$9 WHERE NOT EXISTS (SELECT 1 FROM connect_suppressions s WHERE (s.client_id IS NULL OR s.client_id=$3) AND ((s.email IS NOT NULL AND lower(s.email)=lower($5)) OR (s.domain IS NOT NULL AND lower(s.domain)=lower($10))) ) AND NOT EXISTS (SELECT 1 FROM connect_outreach_messages m WHERE m.prospect_id=$2 AND m.status IN ('DRAFT','QUEUED','SENT','DELIVERED')) RETURNING id`, [messageId, prospect.id, prospect.client_id, CONNECT_FROM_EMAIL, prospect.contact_email, subject, body, experimentKey, experimentVariant, prospect.domain]);
    generated += result.rowCount ?? 0;
  }
  return { segmentId: segmentId ?? null, eligible: rows.length, draftsCreated: generated, messagesSent: 0 };
}
