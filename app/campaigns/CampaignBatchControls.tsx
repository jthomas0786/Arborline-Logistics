import { getPool } from "@/lib/db";
import { previewConnectQueuedOutreach } from "@/lib/connect-outreach-send";
import { CAMPAIGN_STAGE_CAP, previewDraftBatch } from "./batch-preview";

export async function CampaignBatchControls({ selectedClientId }: { selectedClientId?: string | null }) {
  const pool = getPool();
  const clientsResult = await pool.query(
    `SELECT c.id,c.company_name,
       count(m.id) FILTER (WHERE m.status='DRAFT')::int AS draft_count,
       count(m.id) FILTER (WHERE m.status='QUEUED')::int AS queued_count
     FROM connect_clients c
     LEFT JOIN connect_outreach_messages m ON m.client_id=c.id
     WHERE c.status IN ('READY','ACTIVE','ONBOARDING')
     GROUP BY c.id,c.company_name
     ORDER BY c.company_name`
  );
  const clients = clientsResult.rows;
  const selected = clients.find((client) => client.id === selectedClientId)
    ?? clients.find((client) => Number(client.draft_count || 0) > 0)
    ?? clients[0]
    ?? null;
  const [batch, autosend] = await Promise.all([
    selected ? previewDraftBatch(selected.id, CAMPAIGN_STAGE_CAP) : Promise.resolve([]),
    previewConnectQueuedOutreach()
  ]);

  return (
    <section className="panel" style={{ marginBottom: 12 }}>
      <div className="panelHead">
        <div>
          <p className="eyebrow">NEXT BATCH CONTROL</p>
          <h3>Verified draft preview</h3>
        </div>
        <span className="status exception">BULK APPROVAL LOCKED</span>
      </div>

      <p className="muted">Preview the next 1–5 verified-contact drafts here. Bulk approval is temporarily disabled after a stale batch action was found queueing drafts unexpectedly. Approve drafts individually in the Review Queue below.</p>

      <form method="get" className="form" style={{ marginTop: 14, marginBottom: 14 }}>
        <label>
          Batch client
          <select name="batchClient" defaultValue={selected?.id ?? ""}>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.company_name} · {client.draft_count ?? 0} drafts · {client.queued_count ?? 0} queued
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="secondary">Preview client drafts</button>
      </form>

      <div className="health" style={{ marginBottom: 14 }}>
        <div><span>Bulk approval</span><b>LOCKED</b></div>
        <div><span>Individual human approval</span><b>REQUIRED</b></div>
        <div><span>Autosend switch</span><b>{autosend.autosendEnabled ? "ON" : "OFF"}</b></div>
        <div><span>Live-send master switch</span><b>{autosend.liveEnabled ? "ON" : "OFF"}</b></div>
        <div><span>Eligible queued now</span><b>{autosend.eligible}</b></div>
        <div><span>Daily capacity remaining</span><b>{autosend.remainingDaily}</b></div>
        <div><span>Scheduled production cron</span><b>9:00 AM Central</b></div>
      </div>

      {selected ? (
        <>
          <div className="panelHead" style={{ marginTop: 8 }}>
            <div><p className="eyebrow">PREVIEW</p><h3>{selected.company_name}</h3></div>
            <span className="status">{batch.length} candidate{batch.length === 1 ? "" : "s"}</span>
          </div>

          {batch.length ? (
            <>
              {batch.map((row, index) => (
                <article className="exception" key={row.id} style={{ alignItems: "flex-start" }}>
                  <span className="severity">#{index + 1}</span>
                  <div className="grow">
                    <strong>{row.company_name} · {row.contact_name || row.recipient_email}</strong>
                    <p>{row.contact_title || "Decision-maker"} · fit {row.qualification_score ?? 0}/100</p>
                    <p className="muted">{row.recipient_email} · {row.subject}</p>
                  </div>
                  <span className="status">DRAFT</span>
                </article>
              ))}
              <div className="notice" style={{ marginTop: 16 }}>Bulk staging is locked. Review the full message in the Review Queue and use <strong>Approve this draft</strong> only when you intentionally want that specific message queued for 9 AM.</div>
            </>
          ) : (
            <div className="empty">No eligible verified-contact drafts are available for this client.</div>
          )}
        </>
      ) : (
        <div className="empty">No active Connect clients are available.</div>
      )}
    </section>
  );
}
