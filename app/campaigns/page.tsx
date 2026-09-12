import Link from "next/link";
import { AppShell } from "../components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { approveAllDrafts, approveOutreachDraft, generateReadyOutreachDrafts, rejectOutreachDraft } from "./actions";

export const dynamic = "force-dynamic";

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageRole(["STAFF"]);
  const params = await searchParams;
  const pool = getPool();
  const [clientsResult, draftsResult, approvedResult] = await Promise.all([
    pool.query(`
      SELECT c.id,c.company_name,
             count(p.id) FILTER (
               WHERE p.qualification_status='QUALIFIED'
                 AND p.outreach_status='READY'
                 AND p.suppression_status='CLEAR'
                 AND p.contact_email IS NOT NULL
             )::int AS ready_count
      FROM connect_clients c
      LEFT JOIN connect_prospects p ON p.client_id=c.id
      WHERE c.status IN ('READY','ACTIVE','ONBOARDING')
      GROUP BY c.id,c.company_name
      ORDER BY c.company_name
    `),
    pool.query(`
      SELECT m.id,m.client_id,m.subject,m.body_text,m.recipient_email,m.sender_name,m.sender_email,m.created_at,
             p.company_name,p.contact_name,p.contact_title,p.qualification_score,
             c.company_name AS client_company
      FROM connect_outreach_messages m
      JOIN connect_prospects p ON p.id=m.prospect_id
      JOIN connect_clients c ON c.id=m.client_id
      WHERE m.status='DRAFT'
      ORDER BY m.created_at DESC
      LIMIT 50
    `),
    pool.query(`
      SELECT m.id,m.subject,m.recipient_email,m.sender_name,m.created_at,
             p.company_name,p.contact_name,p.contact_title,
             c.company_name AS client_company
      FROM connect_outreach_messages m
      JOIN connect_prospects p ON p.id=m.prospect_id
      JOIN connect_clients c ON c.id=m.client_id
      WHERE m.status='QUEUED'
      ORDER BY m.created_at DESC
      LIMIT 50
    `)
  ]);

  const generated = params.drafts === "generated" ? Number(params.count || 0) : null;
  const approval = typeof params.approval === "string" ? params.approval : null;
  const approvalCount = Number(params.count || 0);

  return (
    <AppShell active="Campaigns">
      <header>
        <div>
          <p className="eyebrow">OUTBOUND AUTOMATION</p>
          <h1>Campaigns</h1>
          <p className="muted">Turn qualified, enriched prospects into personalized outreach drafts, approve them deliberately, and keep live sending locked until compliance is enabled.</p>
        </div>
      </header>

      {generated !== null ? (
        <section className="panel" style={{ marginBottom: 12 }}>
          <strong>{generated} new personalized draft{generated === 1 ? "" : "s"} generated.</strong>
          <p className="muted" style={{ marginBottom: 0 }}>No prospect email was sent. Existing drafts were skipped automatically.</p>
        </section>
      ) : null}

      {approval ? (
        <section className="panel" style={{ marginBottom: 12 }}>
          <strong>{approval === "approved" ? "1 draft approved." : approval === "batch" ? `${approvalCount} draft${approvalCount === 1 ? "" : "s"} approved.` : approval === "rejected" ? "Draft rejected." : "Approval blocked by the latest qualification or suppression check."}</strong>
          <p className="muted" style={{ marginBottom: 0 }}>Approved means eligible for the future send stage only. No prospect email was sent.</p>
        </section>
      ) : null}

      <section className="grid stats">
        <article className="card"><p>Drafts awaiting review</p><h2>{draftsResult.rows.length}</h2><small>Approve or reject individually</small></article>
        <article className="card"><p>Approved</p><h2>{approvedResult.rows.length}</h2><small>Queued internally, not sent</small></article>
        <article className="card"><p>Suppression</p><h2>ON</h2><small>Rechecked at draft + approval</small></article>
        <article className="card"><p>Live outreach</p><h2>LOCKED</h2><small>No dispatcher reads this queue</small></article>
      </section>

      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panelHead">
          <div><p className="eyebrow">DRAFT AUTOMATION</p><h3>Generate personalized outreach</h3></div>
          <span className="status">Review mode</span>
        </div>
        <p className="muted">ArborLine selects only QUALIFIED + READY prospects with a verified contact email and clear suppression status. It skips anyone who already has an active draft or message.</p>
        <form action={generateReadyOutreachDrafts} className="form">
          <div className="formGrid">
            <label>Client
              <select name="clientId" required defaultValue="">
                <option value="" disabled>Select client</option>
                {clientsResult.rows.map((client) => <option key={client.id} value={client.id}>{client.company_name} · {client.ready_count} ready</option>)}
              </select>
            </label>
          </div>
          <button type="submit" style={{ marginTop: 14 }}>Generate drafts for ready prospects</button>
        </form>
      </section>

      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panelHead">
          <div><p className="eyebrow">REVIEW QUEUE</p><h3>Exactly what ArborLine would send</h3></div>
          <Link href="/prospects" className="status">Controlled test sends →</Link>
        </div>
        {draftsResult.rows.length ? (
          <>
            <form action={approveAllDrafts} className="form" style={{ marginBottom: 14 }}>
              <label>Approve all drafts for client
                <select name="clientId" required defaultValue="">
                  <option value="" disabled>Select client</option>
                  {clientsResult.rows.map((client) => <option key={client.id} value={client.id}>{client.company_name}</option>)}
                </select>
              </label>
              <button type="submit">Approve all after suppression recheck</button>
            </form>
            {draftsResult.rows.map((draft) => (
              <article className="exception" key={draft.id} style={{ alignItems: "flex-start" }}>
                <div className="grow">
                  <strong>{draft.company_name} · {draft.contact_name || draft.recipient_email}</strong>
                  <p className="muted">{draft.contact_title || "Decision-maker"} · fit {draft.qualification_score ?? 0}/100 · {draft.client_company}</p>
                  <p><strong>To:</strong> {draft.recipient_email}</p>
                  <p><strong>From:</strong> {draft.sender_name}{draft.sender_email ? ` <${draft.sender_email}>` : ""}</p>
                  <p><strong>Subject:</strong> {draft.subject}</p>
                  <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, marginTop: 12 }}>{draft.body_text}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                    <form action={approveOutreachDraft}>
                      <input type="hidden" name="messageId" value={draft.id} />
                      <button type="submit">Approve draft</button>
                    </form>
                    <form action={rejectOutreachDraft}>
                      <input type="hidden" name="messageId" value={draft.id} />
                      <button type="submit" className="secondary">Reject draft</button>
                    </form>
                  </div>
                </div>
              </article>
            ))}
          </>
        ) : <div className="empty">No drafts awaiting review. Generate drafts from the ready prospect queue above.</div>}
      </section>

      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panelHead"><div><p className="eyebrow">APPROVED QUEUE</p><h3>Approved, still not sent</h3></div><span className="status">Send lock active</span></div>
        {approvedResult.rows.length ? approvedResult.rows.map((row) => (
          <div className="exception" key={row.id}>
            <div className="grow"><strong>{row.company_name} · {row.contact_name || row.recipient_email}</strong><p>{row.subject}</p><p className="muted">{row.client_company} · {row.recipient_email}</p></div>
            <span className="status">APPROVED</span>
          </div>
        )) : <div className="empty">No approved drafts yet.</div>}
      </section>

      <section className="panel">
        <div className="panelHead"><div><p className="eyebrow">CAMPAIGN GUARDRAILS</p><h3>Sending remains intentionally disabled</h3></div></div>
        <div className="health">
          <div><span>Accurate sender identity</span><b>Josh Thomas</b></div>
          <div><span>Suppression checked before drafting</span><b>Active</b></div>
          <div><span>Suppression checked again at approval</span><b>Active</b></div>
          <div><span>Individual + batch approval</span><b>Active</b></div>
          <div><span>Automatic unsubscribe + compliance footer</span><b>Next</b></div>
          <div><span>Live prospect sending</span><b>Locked</b></div>
        </div>
      </section>
    </AppShell>
  );
}
