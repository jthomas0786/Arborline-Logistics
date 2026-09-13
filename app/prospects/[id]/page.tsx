import { notFound } from "next/navigation";
import { AppShell } from "../../components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

function label(value: unknown) {
  return String(value || "").replaceAll("_", " ");
}

export default async function ProspectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageRole(["STAFF"]);
  const { id } = await params;
  const pool = getPool();
  const [prospectResult,handoffResult] = await Promise.all([
    pool.query(`
      SELECT p.*,c.company_name AS client_company,i.minimum_score
      FROM connect_prospects p
      JOIN connect_clients c ON c.id=p.client_id
      LEFT JOIN connect_icp_profiles i ON i.client_id=p.client_id
      WHERE p.id=$1
      LIMIT 1
    `,[id]),
    pool.query(`
      SELECT id,status,booking_type,company_name,contact_name,contact_email,summary,
             suggested_next_step,scheduled_for,meeting_url,client_outcome,outcome_notes,
             outcome_updated_at,held_at,closed_at,updated_at
      FROM connect_handoffs
      WHERE prospect_id=$1
      ORDER BY created_at DESC
      LIMIT 10
    `,[id])
  ]);

  const prospect = prospectResult.rows[0];
  if (!prospect) notFound();
  const reasons = Array.isArray(prospect.qualification_reasons) ? prospect.qualification_reasons : [];
  const signals = Array.isArray(prospect.buying_signals) ? prospect.buying_signals : [];

  return <AppShell active="Prospects">
    <header>
      <div>
        <p className="eyebrow">PROSPECT DETAIL</p>
        <h1>{prospect.company_name}</h1>
        <p className="muted">{prospect.client_company}{prospect.city || prospect.state ? ` · ${[prospect.city,prospect.state].filter(Boolean).join(", ")}` : ""}</p>
      </div>
      <a className="button" href="/prospects">Back to prospects</a>
    </header>

    <section className="grid stats">
      <article className="card"><p>Fit score</p><h2>{prospect.qualification_score ?? 0}/100</h2><small>Floor {prospect.minimum_score ?? 70}</small></article>
      <article className="card"><p>Qualification</p><h2>{label(prospect.qualification_status)}</h2><small>Current prospect state</small></article>
      <article className="card"><p>Outreach</p><h2>{label(prospect.outreach_status)}</h2><small>Current outreach state</small></article>
      <article className="card"><p>Handoffs</p><h2>{handoffResult.rows.length}</h2><small>Qualified next steps</small></article>
    </section>

    <section className="split" style={{marginBottom:12}}>
      <article className="panel">
        <div className="panelHead"><div><p className="eyebrow">COMPANY</p><h3>Prospect profile</h3></div></div>
        <p><strong>Industry:</strong> {prospect.industry || "—"}</p>
        <p><strong>Website:</strong> {prospect.website ? <a href={prospect.website} target="_blank" rel="noreferrer">{prospect.website}</a> : "—"}</p>
        <p><strong>Employees:</strong> {prospect.employee_count ?? "—"}</p>
        <p><strong>Locations:</strong> {prospect.location_count ?? "—"}</p>
        <p><strong>Facility type:</strong> {prospect.facility_type || "—"}</p>
        {signals.length ? <p><strong>Buying signals:</strong> {signals.join(", ")}</p> : null}
      </article>
      <article className="panel">
        <div className="panelHead"><div><p className="eyebrow">CONTACT</p><h3>Decision maker</h3></div></div>
        <p><strong>Name:</strong> {prospect.contact_name || "—"}</p>
        <p><strong>Title:</strong> {prospect.contact_title || "—"}</p>
        <p><strong>Email:</strong> {prospect.contact_email || "—"}</p>
        <p><strong>Phone:</strong> {prospect.contact_phone || "—"}</p>
      </article>
    </section>

    <section className="panel" style={{marginBottom:12}}>
      <div className="panelHead"><div><p className="eyebrow">QUALIFICATION</p><h3>Why this prospect scored this way</h3></div></div>
      {reasons.length ? reasons.map((reason: { label?: string; description?: string; matched?: boolean; points?: number },index: number) => <div className="exception" key={`${reason.label || "reason"}-${index}`}>
        <span className={`severity ${reason.matched ? "ok" : "review"}`}>{reason.matched ? "MATCH" : "MISS"}</span>
        <div className="grow"><strong>{reason.label || "Qualification check"}</strong><p>{reason.description || "No additional detail"}</p></div>
        <strong>{typeof reason.points === "number" ? reason.points : ""}</strong>
      </div>) : <div className="empty">No qualification-reason details are stored for this prospect.</div>}
    </section>

    <section className="panel">
      <div className="panelHead"><div><p className="eyebrow">HANDOFF HISTORY</p><h3>Client outcome trail</h3></div></div>
      {handoffResult.rows.length ? handoffResult.rows.map((handoff) => <div className="exception" key={handoff.id}>
        <span className={`severity ${handoff.client_outcome === "WON" ? "ok" : handoff.client_outcome === "LOST" || handoff.status === "NO_SHOW" ? "block" : "review"}`}>{label(handoff.client_outcome || handoff.status)}</span>
        <div className="grow">
          <strong>{label(handoff.booking_type)} · {handoff.contact_name || "Prospect"}</strong>
          <p>{handoff.summary}</p>
          {handoff.suggested_next_step ? <p><strong>Next step:</strong> {handoff.suggested_next_step}</p> : null}
          {handoff.outcome_notes ? <p><strong>Client outcome note:</strong> {handoff.outcome_notes}</p> : null}
          {handoff.outcome_updated_at ? <small className="muted">Updated {new Date(handoff.outcome_updated_at).toLocaleString()}</small> : null}
        </div>
      </div>) : <div className="empty">No qualified handoff has been created yet.</div>}
    </section>
  </AppShell>;
}
