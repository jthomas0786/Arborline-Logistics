"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";

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

const DEFAULT_RULES = [
  ["FIT", "REQUIRED", "Right company", "Matches the client's geography, industry, size, and service criteria.", 25, 10],
  ["CONTACT", "REQUIRED", "Right person", "Decision maker or someone directly involved in the buying process.", 20, 20],
  ["NEED", "PREFERRED", "Real reason to talk", "A current need, vendor issue, expansion, review window, or other credible buying signal.", 20, 30],
  ["TIMING", "PREFERRED", "Relevant timing", "The prospect has a reason to evaluate the service in a useful timeframe.", 15, 40],
  ["HANDOFF", "REQUIRED", "Agreed next step", "A specific call, estimate, demo, or walkthrough has been accepted.", 20, 50]
] as const;

const CLIENT_STATUSES = new Set(["ONBOARDING", "READY", "ACTIVE", "PAUSED", "CLOSED"]);
const BOOKING_TYPES = new Set(["CALL", "ESTIMATE", "DEMO", "WALKTHROUGH", "OTHER"]);

export async function startClientOnboarding(form: FormData) {
  await requirePageRole(["STAFF"]);

  const pilotInterestId = text(form, "pilotInterestId", 60) || null;
  const companyName = text(form, "companyName", 180);
  const primaryContactName = text(form, "primaryContactName", 120) || null;
  const primaryContactEmail = text(form, "primaryContactEmail", 200).toLowerCase() || null;
  const industry = text(form, "industry", 120) || null;
  const serviceArea = text(form, "serviceArea", 180) || null;
  const website = text(form, "website", 300) || null;
  const serviceSummary = text(form, "serviceSummary", 1200) || null;

  if (!companyName || (primaryContactEmail && !validEmail(primaryContactEmail))) {
    redirect("/clients?error=invalid_client");
  }

  const pool = getPool();
  const client = await pool.query(
    `INSERT INTO connect_clients
      (pilot_interest_id, company_name, website, industry, primary_contact_name, primary_contact_email, service_summary, service_area)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (pilot_interest_id)
     DO UPDATE SET
       company_name=EXCLUDED.company_name,
       website=COALESCE(EXCLUDED.website, connect_clients.website),
       industry=COALESCE(EXCLUDED.industry, connect_clients.industry),
       primary_contact_name=COALESCE(EXCLUDED.primary_contact_name, connect_clients.primary_contact_name),
       primary_contact_email=COALESCE(EXCLUDED.primary_contact_email, connect_clients.primary_contact_email),
       service_summary=COALESCE(EXCLUDED.service_summary, connect_clients.service_summary),
       service_area=COALESCE(EXCLUDED.service_area, connect_clients.service_area),
       updated_at=now()
     RETURNING id`,
    [pilotInterestId, companyName, website, industry, primaryContactName, primaryContactEmail, serviceSummary, serviceArea]
  );

  const clientId = client.rows[0].id as string;
  await pool.query(
    `INSERT INTO connect_icp_profiles (client_id, target_geographies)
     VALUES ($1, $2::text[])
     ON CONFLICT (client_id) DO NOTHING`,
    [clientId, serviceArea ? [serviceArea] : []]
  );

  await pool.query(
    `INSERT INTO connect_qualification_rules
      (client_id, category, rule_type, label, description, weight, sort_order)
     SELECT $1, rule.category, rule.rule_type, rule.label, rule.description, rule.weight, rule.sort_order
     FROM (VALUES
       ${DEFAULT_RULES.map((_, index) => `($${index * 6 + 2},$${index * 6 + 3},$${index * 6 + 4},$${index * 6 + 5},$${index * 6 + 6}::int,$${index * 6 + 7}::int)`).join(",")}
     ) AS rule(category, rule_type, label, description, weight, sort_order)
     WHERE NOT EXISTS (SELECT 1 FROM connect_qualification_rules WHERE client_id=$1)`,
    [clientId, ...DEFAULT_RULES.flat()]
  );

  revalidatePath("/clients");
  redirect(`/clients/${clientId}`);
}

export async function updateClientProfile(form: FormData) {
  await requirePageRole(["STAFF"]);

  const clientId = text(form, "clientId", 60);
  const companyName = text(form, "companyName", 180);
  const email = text(form, "primaryContactEmail", 200).toLowerCase() || null;
  const status = text(form, "status", 30);
  const bookingType = text(form, "bookingType", 30);
  const minimumScore = Math.min(100, Math.max(0, nullableInt(form, "minimumScore") ?? 70));

  if (!clientId || !companyName || (email && !validEmail(email)) || !CLIENT_STATUSES.has(status) || !BOOKING_TYPES.has(bookingType)) {
    redirect("/clients?error=invalid_client");
  }

  const pool = getPool();
  await pool.query(
    `UPDATE connect_clients SET
       company_name=$2,
       website=$3,
       industry=$4,
       primary_contact_name=$5,
       primary_contact_email=$6,
       service_summary=$7,
       service_area=$8,
       status=$9,
       booking_type=$10,
       timezone=$11,
       updated_at=now()
     WHERE id=$1`,
    [
      clientId,
      companyName,
      text(form, "website", 300) || null,
      text(form, "industry", 120) || null,
      text(form, "primaryContactName", 120) || null,
      email,
      text(form, "serviceSummary", 1200) || null,
      text(form, "serviceArea", 180) || null,
      status,
      bookingType,
      text(form, "timezone", 100) || "America/Chicago"
    ]
  );

  await pool.query(
    `INSERT INTO connect_icp_profiles
      (client_id,target_industries,target_geographies,min_employees,max_employees,min_locations,max_locations,facility_types,decision_maker_titles,buying_signals,exclusions,qualification_notes,minimum_score)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (client_id) DO UPDATE SET
       target_industries=EXCLUDED.target_industries,
       target_geographies=EXCLUDED.target_geographies,
       min_employees=EXCLUDED.min_employees,
       max_employees=EXCLUDED.max_employees,
       min_locations=EXCLUDED.min_locations,
       max_locations=EXCLUDED.max_locations,
       facility_types=EXCLUDED.facility_types,
       decision_maker_titles=EXCLUDED.decision_maker_titles,
       buying_signals=EXCLUDED.buying_signals,
       exclusions=EXCLUDED.exclusions,
       qualification_notes=EXCLUDED.qualification_notes,
       minimum_score=EXCLUDED.minimum_score,
       updated_at=now()`,
    [
      clientId,
      list(form, "targetIndustries"),
      list(form, "targetGeographies"),
      nullableInt(form, "minEmployees"),
      nullableInt(form, "maxEmployees"),
      nullableInt(form, "minLocations"),
      nullableInt(form, "maxLocations"),
      list(form, "facilityTypes"),
      list(form, "decisionMakerTitles"),
      list(form, "buyingSignals"),
      list(form, "exclusions"),
      text(form, "qualificationNotes", 3000) || null,
      minimumScore
    ]
  );

  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}?saved=1`);
}
