import { getPool } from "@/lib/db";
import { previewConnectQueuedOutreach } from "@/lib/connect-outreach-send";
import { CAMPAIGN_STAGE_CAP, previewDraftBatch } from "./batch-preview";
import { BatchApprovalPanel } from "./BatchApprovalPanel";
import styles from "./CampaignBatchControls.module.css";

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
    <section className={`panel ${styles.batchPanel}`}>
      <div className={styles.topline}>
        <div>
          <p className="eyebrow">CONTROLLED BULK APPROVAL</p>
          <h3>Review a clean batch, then approve it once</h3>
          <p className={styles.intro}>Only verified-contact drafts that still pass qualification, recipient, and suppression checks can appear here. Approval moves the exact reviewed messages into the controlled queue; it does not send them immediately.</p>
        </div>
        <span className={styles.queueBadge}>9 AM QUEUE</span>
      </div>

      <div className={styles.summaryGrid}>
        <div className={styles.summaryItem}><span>Eligible drafts</span><strong>{batch.length}</strong></div>
        <div className={styles.summaryItem}><span>Queued now</span><strong>{selected?.queued_count ?? 0}</strong></div>
        <div className={styles.summaryItem}><span>Daily capacity</span><strong>{autosend.remainingDaily} remaining</strong></div>
        <div className={styles.summaryItem}><span>Next scheduled send</span><strong>9:00 AM Central</strong></div>
      </div>

      <form method="get" className={styles.selector}>
        <label>
          Campaign client
          <select name="batchClient" defaultValue={selected?.id ?? ""}>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.company_name} · {client.draft_count ?? 0} draft{Number(client.draft_count ?? 0) === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="secondary">Load drafts</button>
      </form>

      {selected && batch.length ? (
        <BatchApprovalPanel clientId={selected.id} clientName={selected.company_name} batch={batch} />
      ) : selected ? (
        <div className={styles.empty}>No eligible verified-contact drafts are waiting for this client.</div>
      ) : (
        <div className={styles.empty}>No active Connect clients are available.</div>
      )}
    </section>
  );
}
