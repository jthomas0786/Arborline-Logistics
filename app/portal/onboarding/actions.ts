"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { requireConnectClient } from "@/lib/connect-client-portal";

const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"
]);
const BOOKING_TYPES = new Set(["CALL","ESTIMATE","DEMO","WALKTHROUGH","OTHER"]);

function text(form: FormData, name: string, max = 1000) {
  return String(form.get(name) ?? "").trim().slice(0, max);
}

function list(form: FormData, name: string) {
  return text(form, name, 3000)
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, values) => values.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index)
    .slice(0, 50);
}

function nullableInt(form: FormData, name: string) {
  const value = text(form, name, 20);
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function validWebsite(value: string) {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function fail(code: string): never {
  redirect(`/portal/onboarding?error=${encodeURIComponent(code)}`);
}

export async function submitClientOnboarding(formData: FormData) {
  const { identity, client } = await requireConnectClient({ allowOnboarding: true });

  if (["ACTIVE","PAUSED","CLOSED"].includes(String(client.status))) {
    redirect("/portal/targeting");
  }

  const companyName = text(formData, "companyName", 180);
  const primaryContactName = text(formData, "primaryContactName", 120);
  const primaryContactPhone = text(formData, "primaryContactPhone", 60) || null;
  const website = text(formData, "website", 300) || null;
  const industry = text(formData, "industry", 120) || null;

  const addressLine1 = text(formData, "businessAddressLine1", 180);
  const addressLine2 = text(formData, "businessAddressLine2", 180) || null;
  const city = text(formData, "businessCity", 100);
  const state = text(formData, "businessState", 2).toUpperCase();
  const postalCode = text(formData, "businessPostalCode", 10);

  const servicesOffered = list(formData, "servicesOffered");
  const serviceSummary = text(formData, "serviceSummary", 1600);
  const serviceArea = text(formData, "serviceArea", 300);
  const bookingType = text(formData, "bookingType", 30).toUpperCase();

  const targetIndustries = list(formData, "targetIndustries");
  const targetGeographies = list(formData, "targetGeographies");
  const facilityTypes = list(formData, "facilityTypes");
  const decisionMakerTitles = list(formData, "decisionMakerTitles");
  const buyingSignals = list(formData, "buyingSignals");
  const exclusions = list(formData, "exclusions");
  const qualificationNotes = text(formData, "qualificationNotes", 3000) || null;
  const minEmployees = nullableInt(formData, "minEmployees");
  const maxEmployees = nullableInt(formData, "maxEmployees");
  const minLocations = nullableInt(formData, "minLocations");
  const maxLocations = nullableInt(formData, "maxLocations");

  if (!companyName || !primaryContactName) fail("contact");
  if (!validWebsite(website || "")) fail("website");
  if (!addressLine1 || !city || !US_STATES.has(state) || !/^\d{5}(?:-\d{4})?$/.test(postalCode)) fail("address");
  if (!servicesOffered.length || serviceSummary.length < 20 || !serviceArea) fail("services");
  if (!BOOKING_TYPES.has(bookingType)) fail("booking");
  if (!targetIndustries.length || !targetGeographies.length || !decisionMakerTitles.length) fail("targeting");
  if (minEmployees !== null && maxEmployees !== null && minEmployees > maxEmployees) fail("employee_range");
  if (minLocations !== null && maxLocations !== null && minLocations > maxLocations) fail("location_range");

  const firstSubmission = !client.onboarding_completed_at;
  const pool = getPool();
  const db = await pool.connect();

  try {
    await db.query("BEGIN");

    await db.query(
      `UPDATE connect_clients SET
         company_name=$2,
         website=$3,
         industry=$4,
         primary_contact_name=$5,
         primary_contact_email=COALESCE(primary_contact_email,$6),
         primary_contact_phone=$7,
         business_address_line1=$8,
         business_address_line2=$9,
         business_city=$10,
         business_state=$11,
         business_postal_code=$12,
         services_offered=$13::text[],
         service_summary=$14,
         service_area=$15,
         booking_type=$16,
         onboarding_completed_at=now(),
         status=CASE WHEN status='ONBOARDING' THEN 'READY' ELSE status END,
         updated_at=now()
       WHERE id=$1`,
      [
        client.id,
        companyName,
        website,
        industry,
        primaryContactName,
        identity.email || null,
        primaryContactPhone,
        addressLine1,
        addressLine2,
        city,
        state,
        postalCode,
        servicesOffered,
        serviceSummary,
        serviceArea,
        bookingType
      ]
    );

    await db.query(
      `INSERT INTO connect_icp_profiles
        (client_id,target_industries,target_geographies,min_employees,max_employees,min_locations,max_locations,
         facility_types,decision_maker_titles,buying_signals,exclusions,qualification_notes)
       VALUES ($1,$2::text[],$3::text[],$4,$5,$6,$7,$8::text[],$9::text[],$10::text[],$11::text[],$12)
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
         updated_at=now()`,
      [
        client.id,
        targetIndustries,
        targetGeographies,
        minEmployees,
        maxEmployees,
        minLocations,
        maxLocations,
        facilityTypes,
        decisionMakerTitles,
        buyingSignals,
        exclusions,
        qualificationNotes
      ]
    );

    if (firstSubmission) {
      await db.query(
        `INSERT INTO connect_client_requests
          (client_id,requested_by,requested_by_email,category,message,status)
         SELECT $1,$2,$3,'PROFILE',$4,'SUBMITTED'
         WHERE NOT EXISTS (
           SELECT 1 FROM connect_client_requests
           WHERE client_id=$1 AND category='PROFILE' AND status IN ('SUBMITTED','IN_REVIEW')
         )`,
        [
          client.id,
          identity.userId,
          identity.email || client.primary_contact_email || null,
          "Client completed post-payment onboarding. Review the business profile and targeting before activating the campaign."
        ]
      );
    }

    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    console.error("Client self-onboarding failed", error);
    redirect("/portal/onboarding?error=save");
  } finally {
    db.release();
  }

  revalidatePath("/portal");
  revalidatePath("/portal/account");
  revalidatePath("/portal/targeting");
  revalidatePath("/portal/onboarding");
  revalidatePath("/clients");
  revalidatePath(`/clients/${client.id}`);
  revalidatePath("/operations");
  revalidatePath("/prospects");
  redirect("/portal/onboarding?saved=1");
}
