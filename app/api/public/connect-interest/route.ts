import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

function field(form: FormData, name: string, max: number) {
  return String(form.get(name) ?? "").trim().slice(0, max);
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 200;
}

function looksLikeSolicitation(input: {
  email: string; company: string; website: string; serviceArea: string; notes: string;
}) {
  const haystack = [input.email, input.company, input.website, input.serviceArea, input.notes]
    .join(" ").toLowerCase();
  const domain = input.email.split("@")[1] || "";

  // Keep this deliberately narrow: reject obvious vendors/bots pitching ArborLine,
  // while allowing unusual but genuine Founding Client applications through.
  const hardSignals = [
    "search-arborlineconnect.com", "web search index", "addwebsite.pro",
    "domainsubmit.site", "no-site.com"
  ];
  if (hardSignals.some((signal) => haystack.includes(signal))) return true;

  const solicitationSignals = [
    "seo", "search engine", "search index", "online presence", "website traffic",
    "rank on google", "google ranking", "backlink", "guest post", "link building",
    "video to advertise", "advertise your business", "our videos", "full proposal",
    "telegram", "whatsapp", "contact us", "we provide a tool", "our service"
  ];
  const hits = solicitationSignals.filter((signal) => haystack.includes(signal)).length;
  const referencesArborLineAsTarget =
    haystack.includes("arborlineconnect.com") || haystack.includes("arborline connect");
  const consumerMailbox = /^(gmail|yahoo|hotmail|outlook|icloud|aol)\./.test(domain);

  return (referencesArborLineAsTarget && hits >= 1) || hits >= 3 ||
    (consumerMailbox && hits >= 2);
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
  // Honeypots and obvious vendor solicitations get the same success response as a
  // legitimate submission so the endpoint does not teach bots how to bypass it.
  if (trap || looksLikeSolicitation({ email, company, website, serviceArea, notes })) {
    return NextResponse.redirect(`${origin}/?submitted=1#pilot`, 303);
  }
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
