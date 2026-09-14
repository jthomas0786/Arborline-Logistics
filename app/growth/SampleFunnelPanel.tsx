import Link from "next/link";
import { getPool } from "@/lib/db";
import { sampleDeliveryConfigured } from "@/lib/connect-free-sample-delivery";

export async function SampleFunnelPanel() {
  const pool = getPool();
  const config = sampleDeliveryConfigured();
  let stats = { total:0, requested:0, ready:0, approved:0, sent:0, viewed:0, interested:0, converted:0, failed:0 };

  try {
    const result = await pool.query(`SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE sample_status='REQUESTED')::int AS requested,
      count(*) FILTER (WHERE sample_status='READY' AND sample_approved_at IS NULL)::int AS ready,
      count(*) FILTER (WHERE sample_approved_at IS NOT NULL AND sample_email_status NOT IN ('SENT','FAILED'))::int AS approved,
      count(*) FILTER (WHERE sample_email_status='SENT')::int AS sent,
      count(*) FILTER (WHERE sample_view_count > 0)::int AS viewed,
      count(*) FILTER (WHERE sample_conversion_status='INTERESTED')::int AS interested,
      count(*) FILTER (WHERE sample_conversion_status='CONVERTED')::int AS converted,
      count(*) FILTER (WHERE sample_email_status='FAILED')::int AS failed
      FROM connect_pilot_interest
      WHERE request_type='FREE_SAMPLE'`);
    stats = { ...stats, ...(result.rows[0] ?? {}) };
  } catch {
    return null;
  }

  return <section className="panel" style={{marginBottom:12}}>
    <div className="panelHead">
      <div><p className="eyebrow">INBOUND SAMPLE FUNNEL</p><h3>Website visitor → sample → Founding Client</h3></div>
      <span className="status">{config.ready ? "Delivery ready" : "Delivery locked"}</span>
    </div>
    <div className="health">
      <div><span>Requests</span><b>{stats.total}</b></div>
      <div><span>Need generation</span><b>{stats.requested}</b></div>
      <div><span>Ready to approve</span><b>{stats.ready}</b></div>
      <div><span>Approved / draft</span><b>{stats.approved}</b></div>
      <div><span>Sent</span><b>{stats.sent}</b></div>
      <div><span>Opened</span><b>{stats.viewed}</b></div>
      <div><span>Interested</span><b>{stats.interested}</b></div>
      <div><span>Converted</span><b>{stats.converted}</b></div>
      <div><span>Delivery failures</span><b>{stats.failed}</b></div>
    </div>
    <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
      <Link className="button" href="/growth/samples">Open sample queue</Link>
      <a className="button" href="/sample" target="_blank" rel="noreferrer">Open public funnel</a>
    </div>
    <small className="muted">Sample delivery remains explicit. Opens are recorded when the private customer link loads and can include automated email-link scanners, so treat them as directional engagement rather than guaranteed human views.</small>
  </section>;
}
