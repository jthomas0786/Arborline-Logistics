import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

function field(form: FormData, name: string, max: number) {
  return String(form.get(name) ?? "").trim().slice(0, max);
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 200;
}

function safeWebsite(value: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString().slice(0, 300) : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const form = await request.formData();
  const trap = field(form, "website_url", 200);
  const name = field(form, "name", 120);
  const email = field(form, "email", 200).toLowerCase();
  const company = field(form, "company", 180);
  const industry = field(form, "industry", 120);
  const serviceArea = field(form, "serviceArea", 180);
  const website = safeWebsite(field(form, "website", 300));
  const targetCustomer = field(form, "targetCustomer", 1400);
  const decisionMakerTitles = field(form, "decisionMakerTitles", 400);
  const notes = field(form, "notes", 1000);

  const origin = new URL(request.url).origin;
  if (trap) return NextResponse.redirect(`${origin}/sample?submitted=1`, 303);
  if (!name || !company || !validEmail(email) || !targetCustomer) {
    return NextResponse.redirect(`${origin}/sample?error=invalid`, 303);
  }

  const pool = getPool();
  const duplicate = await pool.query(
    `SELECT id FROM connect_pilot_interest
     WHERE request_type='FREE_SAMPLE'
       AND lower(work_email)=lower($1)
       AND lower(company_name)=lower($2)
       AND created_at > now() - interval '24 hours'
     LIMIT 1`,
    [email, company]
  );

  if (!duplicate.rows.length) {
    await pool.query(
      `INSERT INTO connect_pilot_interest
       (name,work_email,company_name,industry,service_area,website,notes,source,request_type,target_customer,decision_maker_titles,sample_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'FREE_SAMPLE','FREE_SAMPLE',$8,$9,'REQUESTED')`,
      [
        name,
        email,
        company,
        industry || null,
        serviceArea || null,
        website,
        notes || null,
        targetCustomer,
        decisionMakerTitles || null
      ]
    );
  }

  return NextResponse.redirect(`${origin}/sample?submitted=1`, 303);
}
