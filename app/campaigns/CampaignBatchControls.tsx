import { getPool } from "@/lib/db";
import { previewConnectQueuedOutreach } from "@/lib/connect-outreach-send";
import { stageControlledOutreachBatch } from "./batch-actions";
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
          <h3>Stage a controlled prospect batch</h3>
        </div>
        <span className="status">{autosend.ready ? "AUTOSEND ARMED" : "AUTOSEND LOCKED"}</span>
      </div>

      <p className="muted">Preview the next 1–5 verified-contact drafts. Staging is an explicit human approval for the 9 AM send queue; no email is sent immediately.</p>

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
        <button type="submit" className="secondary">Preview client batch</button>
      </form>

      <div className="health" style={{ marginBottom: 14 }}>
        <div><span>Autosend switch</span><b>{autosend.autosendEnabled ? "ON" : "OFF"}</b></div>
        <div><span>Live-send master switch</span><b>{autosend.liveEnabled ? "ON" : "OFF"}</b></div>
        <div><span>Allowlisted clients</span><b>{autosend.allowedClients}</b></div>
        <div><span>Autosend batch limit</span><b>{autosend.batchLimit} / hard cap {autosend.hardBatchCap}</b></div>
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

              <form action={stageControlledOutreachBatch} className="form" style={{ marginTop: 16 }} autoComplete="off">
                <input type="hidden" name="clientId" value={selected.id} />
                <label>
                  Stage size
                  <select name="batchSize" defaultValue={String(Math.min(CAMPAIGN_STAGE_CAP, batch.length))}>
                    {Array.from({ length: Math.min(CAMPAIGN_STAGE_CAP, batch.length) }, (_, index) => index + 1).map((size) => (
                      <option key={size} value={size}>{size} prospect{size === 1 ? "" : "s"}</option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <input type="checkbox" name="confirmApproval" value="APPROVE" required />
                  <span>I approve this reviewed batch to enter the 9 AM outreach queue.</span>
                </label>
                <label>
                  Final approval phrase
                  <input name="approvalText" placeholder="Type APPROVE BATCH" autoComplete="off" required />
                  <span className="hint">Type <strong>APPROVE BATCH</strong> exactly. This prevents stale or accidental form submissions from queueing outreach.</span>
                </label>
                <button type="submit">Approve selected batch for 9 AM</button>
              </form>
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
