import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

function field(form: FormData, name: string, max: number) {
  return String(form.get(name) ?? "").trim().slice(0, max);
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 200;
}

export async function POST(request: Request) {
  const form = await request.formData();
  const trap = field(form, "website_url", 200);
  const name = field(form, "name", 120);
  const email = field(form, "email", 200).toLowerCase();
  const company = field(form, "company", 180);
  const industry = field(form, "industry", 120);
  const serviceArea = field(form, "serviceArea", 180);
  const website = field(form, "website", 300);
  const notes = field(form, "notes", 1200);

  const origin = new URL(request.url).origin;
  if (trap) return NextResponse.redirect(`${origin}/?submitted=1#pilot`, 303);
  if (!name || !company || !validEmail(email)) return NextResponse.redirect(`${origin}/?error=invalid#pilot`, 303);

  const pool = getPool();
  const duplicate = await pool.query(
    `SELECT id FROM connect_pilot_interest
     WHERE lower(work_email)=lower($1) AND lower(company_name)=lower($2)
       AND created_at > now() - interval '24 hours'
     LIMIT 1`,
    [email, company]
  );

  if (!duplicate.rows.length) {
    await pool.query(
      `INSERT INTO connect_pilot_interest
       (name,work_email,company_name,industry,service_area,website,notes,source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'WEBSITE')`,
      [name, email, company, industry || null, serviceArea || null, website || null, notes || null]
    );
  }

  return NextResponse.redirect(`${origin}/?submitted=1#pilot`, 303);
}
