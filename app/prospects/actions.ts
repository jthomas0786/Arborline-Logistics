"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { scoreConnectProspect, type ConnectIcpProfile } from "@/lib/connect-prospect-scoring";

function text(form: FormData, name: string, max = 1000) {
  return String(form.get(name) ?? "").trim().slice(0, max);
}

function nullableInt(form: FormData, name: string) {
  const value = text(form, name, 20);
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function list(form: FormData, name: string) {
  return text(form, name, 2000)
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 50);
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 200;
}

function domainFromWebsite(value: string) {
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return value.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || null;
  }
}

function verifiedIndustryEvidence(sourceMetadata: unknown) {
  if (!sourceMetadata || typeof sourceMetadata !== "object") return null;
  const metadata = sourceMetadata as Record<string, unknown>;
  const review = metadata.quality_review;
  if (!review || typeof review !== "object") return null;
  const qualityReview = review as Record<string, unknown>;
  if (String(qualityReview.status || "").toUpperCase() !== "QUALIFIED") return null;
  const reason = String(qualityReview.reason || "").trim();
  return reason ? reason.slice(0, 300) : null;
}

async function scoreAndPersist(prospectId: string) {
  const pool = getPool();
  const result = await pool.query(
    `SELECT p.*,
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
            EXISTS (
              SELECT 1 FROM connect_suppressions s
              WHERE (s.client_id IS NULL OR s.client_id=p.client_id)
                AND ((s.email IS NOT NULL AND lower(s.email)=lower(p.contact_email))
                  OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain)))
            ) AS is_suppressed
     FROM connect_prospects p
     JOIN connect_icp_profiles i ON i.client_id=p.client_id
     LEFT JOIN connect_prospect_segments seg ON seg.id=p.segment_id AND seg.client_id=p.client_id
     WHERE p.id=$1`,
    [prospectId]
  );

  const row = result.rows[0];
  if (!row) throw new Error("Prospect or client ICP not found.");

  const suppressionStatus = row.is_suppressed ? "DO_NOT_CONTACT" : row.suppression_status;
  const reviewedIndustry = verifiedIndustryEvidence(row.source_metadata);
  const scoring = scoreConnectProspect(
    {
      company_name: row.company_name,
      domain: row.domain,
      industry: [row.industry, reviewedIndustry].filter(Boolean).join(" · ") || null,
      city: row.city,
      state: row.state,
      country: row.country,
      employee_count: row.employee_count,
      location_count: row.location_count,
      facility_type: row.facility_type,
      contact_title: row.contact_title,
      buying_signals: row.buying_signals,
      suppression_status: suppressionStatus
    },
    {
      target_industries: row.target_industries ?? [],
      target_geographies: row.target_geographies ?? [],
      min_employees: row.min_employees,
      max_employees: row.max_employees,
      min_locations: row.min_locations,
      max_locations: row.max_locations,
      facility_types: row.facility_types ?? [],
      decision_maker_titles: row.decision_maker_titles ?? [],
      buying_signals: row.icp_buying_signals ?? [],
      exclusions: row.exclusions ?? [],
      minimum_score: row.minimum_score ?? 70
    } satisfies ConnectIcpProfile
  );

  const outreachStatus = scoring.status === "QUALIFIED" && row.contact_email ? "READY" : "NOT_READY";
  await pool.query(
    `UPDATE connect_prospects SET
       qualification_score=$2,
       qualification_status=$3,
       qualification_reasons=$4::jsonb,
       suppression_status=$5,
       outreach_status=CASE WHEN outreach_status IN ('CONTACTED','REPLIED','BOOKED','STOPPED') THEN outreach_status ELSE $6 END,
       last_scored_at=now(),
       updated_at=now()
     WHERE id=$1`,
    [prospectId, scoring.score, scoring.status, JSON.stringify(scoring.reasons), suppressionStatus, outreachStatus]
  );
}

export async function addProspect(form: FormData) {
  await requirePageRole(["STAFF"]);
  const clientId = text(form, "clientId", 60);
  const companyName = text(form, "companyName", 180);
  const website = text(form, "website", 300) || null;
  const contactEmail = text(form, "contactEmail", 200).toLowerCase() || null;

  if (!clientId || !companyName || (contactEmail && !validEmail(contactEmail))) redirect("/prospects?error=invalid_prospect");

  const pool = getPool();
  const inserted = await pool.query(
    `INSERT INTO connect_prospects
      (client_id,company_name,website,domain,industry,city,state,country,employee_count,location_count,facility_type,
       contact_name,contact_title,contact_email,source,source_url,buying_signals,enrichment_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'PARTIAL')
     RETURNING id`,
    [
      clientId,
      companyName,
      website,
      domainFromWebsite(website || text(form, "domain", 200)),
      text(form, "industry", 120) || null,
      text(form, "city", 120) || null,
      text(form, "state", 80) || null,
      text(form, "country", 80) || "US",
      nullableInt(form, "employeeCount"),
      nullableInt(form, "locationCount"),
      text(form, "facilityType", 120) || null,
      text(form, "contactName", 120) || null,
      text(form, "contactTitle", 160) || null,
      contactEmail,
      text(form, "source", 120) || "MANUAL",
      text(form, "sourceUrl", 500) || null,
      list(form, "buyingSignals")
    ]
  );

  await scoreAndPersist(inserted.rows[0].id);
  revalidatePath("/prospects");
  redirect("/prospects?added=1");
}

export async function rescoreProspect(form: FormData) {
  await requirePageRole(["STAFF"]);
  const prospectId = text(form, "prospectId", 60);
  if (!prospectId) return;
  await scoreAndPersist(prospectId);
  revalidatePath("/prospects");
}

export async function suppressProspect(form: FormData) {
  await requirePageRole(["STAFF"]);
  const prospectId = text(form, "prospectId", 60);
  const pool = getPool();
  const { rows } = await pool.query(`SELECT id,client_id,contact_email,domain FROM connect_prospects WHERE id=$1`, [prospectId]);
  const prospect = rows[0];
  if (!prospect) return;

  if (prospect.contact_email) {
    await pool.query(
      `INSERT INTO connect_suppressions (client_id,email,reason,source)
       VALUES ($1,$2,'DO_NOT_CONTACT','STAFF') ON CONFLICT DO NOTHING`,
      [prospect.client_id, prospect.contact_email]
    );
  }
  await pool.query(
    `UPDATE connect_prospects SET suppression_status='DO_NOT_CONTACT',qualification_status='SUPPRESSED',outreach_status='STOPPED',updated_at=now() WHERE id=$1`,
    [prospectId]
  );
  revalidatePath("/prospects");
}

export async function createOutreachDraft(form: FormData) {
  await requirePageRole(["STAFF"]);
  const prospectId = text(form, "prospectId", 60);
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT p.*,c.company_name AS client_company,c.service_summary,c.booking_type
     FROM connect_prospects p JOIN connect_clients c ON c.id=p.client_id
     WHERE p.id=$1 AND p.qualification_status='QUALIFIED' AND p.suppression_status='CLEAR' AND p.contact_email IS NOT NULL`,
    [prospectId]
  );
  const prospect = rows[0];
  if (!prospect) return;

  const firstName = String(prospect.contact_name || "there").split(/\s+/)[0];
  const booking = String(prospect.booking_type || "CALL").toLowerCase();
  const subject = `${prospect.client_company} — quick question`;
  const serviceLine = prospect.service_summary
    ? String(prospect.service_summary).replace(/\s+/g, " ").slice(0, 260)
    : `services from ${prospect.client_company}`;
  const body = `Hi ${firstName},\n\nI’m Josh Thomas with ArborLine Connect. I’m reaching out because ${prospect.company_name} looks like it may be a fit for ${prospect.client_company}. They provide ${serviceLine}.\n\nWould you be open to a quick ${booking} to see if it makes sense to talk?\n\nBest,\nJosh Thomas\nArborLine Connect`;

  await pool.query(
    `INSERT INTO connect_outreach_messages
      (prospect_id,client_id,sender_name,sender_email,recipient_email,subject,body_text,status)
     VALUES ($1,$2,'Josh Thomas',$3,$4,$5,$6,'DRAFT')`,
    [prospect.id, prospect.client_id, process.env.RESEND_FROM_EMAIL?.trim() || null, prospect.contact_email, subject, body]
  );
  revalidatePath("/prospects");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char] || char));
}

export async function sendOutreachTest(form: FormData) {
  await requirePageRole(["STAFF"]);
  const messageId = text(form, "messageId", 60);
  const testRecipient = text(form, "testRecipient", 200).toLowerCase();
  if (!messageId || !validEmail(testRecipient)) return;

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from) throw new Error("Resend is not configured for test sending.");

  const { rows } = await getPool().query(
    `SELECT m.subject,m.body_text,p.company_name FROM connect_outreach_messages m JOIN connect_prospects p ON p.id=m.prospect_id WHERE m.id=$1 AND m.status='DRAFT'`,
    [messageId]
  );
  const message = rows[0];
  if (!message) return;

  const htmlBody = escapeHtml(message.body_text).replace(/\n/g, "<br />");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [testRecipient],
      subject: `[TEST] ${message.subject}`,
      text: `TEST EMAIL — intended prospect: ${message.company_name}\n\n${message.body_text}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#122033"><div style="padding:12px 16px;background:#eef5ff;border-radius:10px;margin-bottom:18px"><strong>ArborLine Connect test</strong><br/>Intended prospect: ${escapeHtml(message.company_name)}</div><div style="line-height:1.6">${htmlBody}</div></div>`
    })
  });

  if (!response.ok) throw new Error(`Resend test failed (${response.status}).`);
  revalidatePath("/prospects");
  redirect("/prospects?testSent=1");
}
