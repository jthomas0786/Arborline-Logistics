"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { processConnectWorkerJobs, queueConnectPipeline } from "@/lib/connect-workers";

const SELF_CLIENT_NAME = "ArborLine Connect";

export async function initializeSelfAcquisitionCampaign() {
  await requirePageRole(["STAFF"]);
  const pool = getPool();
  const db = await pool.connect();
  let clientId = "";

  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext('arborline-connect-self-acquisition'))");

    const existing = await db.query(
      `SELECT id FROM connect_clients WHERE lower(company_name)=lower($1) ORDER BY created_at LIMIT 1`,
      [SELF_CLIENT_NAME]
    );

    if (existing.rows[0]?.id) {
      clientId = existing.rows[0].id;
      await db.query(
        `UPDATE connect_clients SET website=$2,industry=$3,primary_contact_name=$4,primary_contact_email=$5,service_summary=$6,service_area=$7,status='READY',booking_type='CALL',timezone='America/Chicago',updated_at=now() WHERE id=$1`,
        [clientId,"https://www.arborlineconnect.com","B2B Lead Generation & Appointment Setting","Josh Thomas","josh@arborlineconnect.com","ArborLine Connect finds qualified B2B prospects, identifies decision-makers, runs personalized outreach and follow-up, and creates qualified sales conversations for recurring service businesses.","Illinois, Indiana, Wisconsin"]
      );
    } else {
      const created = await db.query(
        `INSERT INTO connect_clients (company_name,website,industry,primary_contact_name,primary_contact_email,service_summary,service_area,status,booking_type,timezone) VALUES ($1,$2,$3,$4,$5,$6,$7,'READY','CALL','America/Chicago') RETURNING id`,
        [SELF_CLIENT_NAME,"https://www.arborlineconnect.com","B2B Lead Generation & Appointment Setting","Josh Thomas","josh@arborlineconnect.com","ArborLine Connect finds qualified B2B prospects, identifies decision-makers, runs personalized outreach and follow-up, and creates qualified sales conversations for recurring service businesses.","Illinois, Indiana, Wisconsin"]
      );
      clientId = created.rows[0].id;
    }

    await db.query(
      `INSERT INTO connect_icp_profiles (client_id,target_industries,target_geographies,min_employees,max_employees,min_locations,max_locations,facility_types,decision_maker_titles,buying_signals,exclusions,qualification_notes,minimum_score)
       VALUES ($1,$2::text[],$3::text[],10,250,NULL,NULL,'{}'::text[],$4::text[],'{}'::text[],$5::text[],$6,70)
       ON CONFLICT (client_id) DO UPDATE SET target_industries=EXCLUDED.target_industries,target_geographies=EXCLUDED.target_geographies,min_employees=EXCLUDED.min_employees,max_employees=EXCLUDED.max_employees,min_locations=NULL,max_locations=NULL,facility_types='{}'::text[],decision_maker_titles=EXCLUDED.decision_maker_titles,buying_signals='{}'::text[],exclusions=EXCLUDED.exclusions,qualification_notes=EXCLUDED.qualification_notes,minimum_score=EXCLUDED.minimum_score,updated_at=now()`,
      [
        clientId,
        ["Commercial Cleaning","Janitorial Services","Facilities Services"],
        ["Illinois","Indiana","Wisconsin"],
        ["Owner","President","CEO","Founder","VP Sales","Vice President of Sales","Director of Business Development","Sales Director"],
        ["Residential Cleaning","House Cleaning","Maid Service"],
        "ArborLine self-acquisition campaign. Target established commercial cleaning and janitorial companies that can economically benefit from recurring B2B customer acquisition. Do not treat residential-only cleaning companies as qualified. Initial launch geography is IL/IN/WI for controlled validation; the platform itself remains nationwide."
      ]
    );

    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    console.error("Failed to initialize ArborLine self-acquisition campaign", error);
    redirect("/growth?setup=failed");
  } finally {
    db.release();
  }

  revalidatePath("/growth");
  revalidatePath("/clients");
  revalidatePath("/sourcing");
  redirect(`/growth?setup=ready&client=${encodeURIComponent(clientId)}`);
}

export async function queueSelfAcquisitionWorkerPipeline() {
  await requirePageRole(["STAFF"]);
  const { rows } = await getPool().query(
    `SELECT id FROM connect_clients WHERE lower(company_name)=lower($1) ORDER BY created_at LIMIT 1`,
    [SELF_CLIENT_NAME]
  );
  const clientId = rows[0]?.id as string | undefined;
  if (!clientId) redirect("/growth?workers=setup_required");

  try {
    await queueConnectPipeline(clientId, "DRY_RUN");
    const run = await processConnectWorkerJobs({
      clientId,
      mode: "DRY_RUN",
      workerTypes: ["SOURCE","ENRICH","QUALIFY","OUTREACH_PREPARE"],
      limit: 4,
      workerId: "growth-dry-run"
    });
    revalidatePath("/growth");
    redirect(`/growth?workers=${run.claimed > 0 ? "ran" : "already_ran"}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    console.error("Failed to run Connect worker dry-run", error);
    redirect("/growth?workers=failed");
  }
}

export async function runSelfAcquisitionActivePilot() {
  await requirePageRole(["STAFF"]);
  if (process.env.CONNECT_WORKERS_ENABLED !== "true") redirect("/growth?pilot=workers_off");
  if (process.env.CONNECT_WORKERS_PROVIDER_SPEND_ENABLED !== "true") redirect("/growth?pilot=provider_off");

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id FROM connect_clients WHERE lower(company_name)=lower($1) ORDER BY created_at LIMIT 1`,
    [SELF_CLIENT_NAME]
  );
  const clientId = rows[0]?.id as string | undefined;
  if (!clientId) redirect("/growth?pilot=setup_required");

  try {
    const existing = await pool.query(
      `SELECT id FROM connect_worker_jobs
       WHERE client_id=$1 AND worker_type='SOURCE' AND mode='ACTIVE'
         AND status IN ('QUEUED','RUNNING','RETRY')
       ORDER BY created_at DESC LIMIT 1`,
      [clientId]
    );
    if (!existing.rows[0]) await queueConnectPipeline(clientId, "ACTIVE");

    const run = await processConnectWorkerJobs({
      clientId,
      mode: "ACTIVE",
      workerTypes: ["SOURCE","ENRICH","QUALIFY","OUTREACH_PREPARE"],
      limit: 4,
      workerId: "growth-active-pilot"
    });

    revalidatePath("/growth");
    revalidatePath("/sourcing");
    revalidatePath("/campaigns");
    const status = run.failed > 0 || run.retried > 0 || run.blocked > 0 ? "attention" : run.claimed > 0 ? "ran" : "nothing_to_run";
    redirect(`/growth?pilot=${status}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    console.error("Failed to run active Connect pilot", error);
    redirect("/growth?pilot=failed");
  }
}
