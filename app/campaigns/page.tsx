import Link from "next/link";
import { AppShell } from "../components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { approveOutreachDraft, generateReadyOutreachDrafts, rejectOutreachDraft, sendApprovedOutreachTest, sendApprovedOutreachLive } from "./actions";
import { CampaignBatchControls } from "./CampaignBatchControls";
import { CampaignPerformancePanel } from "./CampaignPerformancePanel";

export const dynamic = "force-dynamic";

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageRole(["STAFF"]);
  const params = await searchParams;
  const pool = getPool();
  const [clientsResult, draftsResult, approvedResult, sentResult] = await Promise.all([
    pool.query(`SELECT c.id,c.company_name,count(p.id) FILTER (WHERE p.qualification_status='QUALIFIED' AND p.outreach_status='READY' AND p.suppression_status='CLEAR' AND p.contact_email IS NOT NULL)::int AS ready_count FROM connect_clients c LEFT JOIN connect_prospects p ON p.client_id=c.id WHERE c.status IN ('READY','ACTIVE','ONBOARDING') GROUP BY c.id,c.company_name ORDER BY c.company_name`),
    pool.query(`SELECT m.id,m.prospect_id,m.client_id,m.subject,m.body_text,m.recipient_email,m.sender_name,m.sender_email,m.status,m.created_at,p.company_name,p.contact_name,p.contact_title,p.qualification_score,c.company_name AS client_company FROM connect_outreach_messages m JOIN connect_prospects p ON p.id=m.prospect_id JOIN connect_clients c ON c.id=m.client_id WHERE m.status='DRAFT' ORDER BY m.created_at DESC LIMIT 50`),
    pool.query(`SELECT m.id,m.subject,m.body_text,m.recipient_email,m.sender_name,m.sender_email,m.created_at,p.company_name,p.contact_name,p.contact_title,c.company_name AS client_company FROM connect_outreach_messages m JOIN connect_prospects p ON p.id=m.prospect_id JOIN connect_clients c ON c.id=m.client_id WHERE m.status='QUEUED' ORDER BY m.updated_at DESC,m.created_at DESC LIMIT 50`),
    pool.query(`SELECT count(*)::int AS count FROM connect_outreach_messages WHERE status IN ('SENT','DELIVERED') AND sent_at >= date_trunc('day',now())`)
  ]);

  const generated = params.drafts === "generated" ? Number(params.count || 0) : null;
  const approval = typeof params.approval === "string" ? params.approval : null;
  const test = typeof params.test === "string" ? params.test : null;
  const live = typeof params.live === "string" ? params.live : null;
  const staging = typeof params.staging === "string" ? params.staging : null;
  const stagedCount = Number(params.count || 0);
  const batchClient = typeof params.batchClient === "string" ? params.batchClient : null;
  const performanceClient = typeof params.performanceClient === "string" ? params.performanceClient : null;
  const performanceSegment = typeof params.performanceSegment === "string" ? params.performanceSegment : null;
  const reviewDraft = typeof params.reviewDraft === "string" ? params.reviewDraft : null;
  const liveEnabled = process.env.CONNECT_LIVE_OUTREACH_ENABLED === "true";
  const hasPostalAddress = Boolean(process.env.CONNECT_BUSINESS_POSTAL_ADDRESS?.trim());
  const hasUnsubscribeSecret = Boolean(process.env.CONNECT_UNSUBSCRIBE_SECRET?.trim());
  const dailyLimit = Math.max(1, Math.min(100, Number(process.env.CONNECT_DAILY_SEND_LIMIT || 10) || 10));
  const sendReady = liveEnabled && hasPostalAddress && hasUnsubscribeSecret;

  return (
    <AppShell active="Campaigns">
      <header><div><p className="eyebrow">OUTBOUND AUTOMATION</p><h1>Campaigns</h1><p className="muted">Qualify, review, safely stage, and measure outreach before expanding production delivery.</p></div></header>

      {generated !== null ? <section className="panel" style={{ marginBottom: 12 }}><strong>{generated} new personalized draft{generated === 1 ? "" : "s"} generated.</strong><p className="muted" style={{ marginBottom: 0 }}>No prospect email was sent. Existing drafts were skipped automatically.</p></section> : null}
      {approval ? <section className="panel" style={{ marginBottom: 12 }}><strong>{approval === "approved" ? "1 draft approved." : approval === "rejected" ? "Draft rejected." : "Approval blocked by the latest qualification or suppression check."}</strong><p className="muted" style={{ marginBottom: 0 }}>Approved means queued for controlled sending. No prospect email was sent by this approval action.</p></section> : null}
      {staging ? <section className="panel" style={{ marginBottom: 12 }}><strong>{staging === "approved" ? `${stagedCount} draft${stagedCount === 1 ? "" : "s"} approved for the controlled queue.` : staging === "stale" ? "Batch changed before approval." : staging === "confirmation_required" ? "Batch approval needs the final confirmation." : "Batch approval was blocked by the latest safety checks."}</strong><p className="muted" style={{ marginBottom: 0 }}>{staging === "approved" ? "Only the exact drafts shown in the reviewed batch were queued. Nothing was sent immediately." : "Reload the batch and review the current exact recipients before approving again."}</p></section> : null}
      {test ? <section className="panel" style={{ marginBottom: 12 }}><strong>{test === "sent" ? "Controlled test email accepted by Resend." : test === "blocked" ? "Test blocked by the latest qualification or suppression check." : "Enter a valid test recipient."}</strong><p className="muted" style={{ marginBottom: 0 }}>Controlled tests are redirected to the address you enter. The prospect recipient is never used.</p></section> : null}
      {live ? <section className="panel" style={{ marginBottom: 12 }}><strong>{live === "sent" ? "Production outreach accepted by Resend." : live === "limit" ? "Daily send limit reached." : live === "blocked" ? "Live send blocked by the latest prospect checks." : "Live outreach remains locked by compliance configuration."}</strong></section> : null}

      <section className="grid stats">
        <article className="card"><p>Drafts awaiting review</p><h2>{draftsResult.rows.length}</h2><small>Review before queueing</small></article>
        <article className="card"><p>Queued</p><h2>{approvedResult.rows.length}</h2><small>Human-approved, not necessarily sent</small></article>
        <article className="card"><p>Final safety gate</p><h2>ON</h2><small>Qualification + recipient + suppression rechecked</small></article>
        <article className="card"><p>Live prospect outreach</p><h2>{sendReady ? "ARMED" : "LOCKED"}</h2><small>{sendReady ? `${sentResult.rows[0]?.count ?? 0}/${dailyLimit} sent today` : "Compliance prerequisites incomplete or master switch off"}</small></article>
      </section>

      <CampaignPerformancePanel selectedClientId={performanceClient} selectedSegmentId={performanceSegment} />

      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panelHead"><div><p className="eyebrow">COMPLIANCE READINESS</p><h3>Production send prerequisites</h3></div><span className="status">{sendReady ? "Ready" : "Locked"}</span></div>
        <div className="health"><div><span>Sender identity</span><b>Josh Thomas</b></div><div><span>Verified send domain</span><b>mail.arborlineconnect.com</b></div><div><span>Reply routing</span><b>josh@arborlineconnect.com</b></div><div><span>One-click unsubscribe secret</span><b>{hasUnsubscribeSecret ? "Configured" : "Missing"}</b></div><div><span>Business postal address</span><b>{hasPostalAddress ? "Configured" : "Missing"}</b></div><div><span>Daily send cap</span><b>{dailyLimit}/day</b></div><div><span>Master live-send switch</span><b>{liveEnabled ? "ON" : "OFF"}</b></div><div><span>Bounce/complaint suppression</span><b>Automatic</b></div></div>
        {!sendReady ? <p className="muted" style={{ marginTop: 14 }}>Live prospect delivery cannot run until the postal address, unsubscribe signing secret, and master switch are all configured. Controlled tests remain available.</p> : null}
      </section>

      <CampaignBatchControls selectedClientId={batchClient} />

      <section className="panel" style={{ marginBottom: 12 }}><div className="panelHead"><div><p className="eyebrow">DRAFT AUTOMATION</p><h3>Generate personalized outreach</h3></div><span className="status">Review mode</span></div><p className="muted">Only QUALIFIED + READY prospects with a verified contact email and clear suppression status are selected.</p><form action={generateReadyOutreachDrafts} className="form"><div className="formGrid"><label>Client<select name="clientId" required defaultValue=""><option value="" disabled>Select client</option>{clientsResult.rows.map((client) => <option key={client.id} value={client.id}>{client.company_name} · {client.ready_count} ready</option>)}</select></label></div><button type="submit" style={{ marginTop: 14 }}>Generate drafts for ready prospects</button></form></section>

      <section id="review-queue" className="panel" style={{ marginBottom: 12, scrollMarginTop: 96 }}>
        <div className="panelHead"><div><p className="eyebrow">REVIEW QUEUE</p><h3>Exactly what ArborLine would send</h3></div><Link href="/prospects" className="status">Prospects →</Link></div>
        <p className="muted" style={{ marginBottom: 14 }}>Drafts can be approved one at a time here or through the reviewed batch control above. Every approval path rechecks qualification, the exact recipient, verified-contact evidence, and suppression status before a message can enter the queue.</p>
        {draftsResult.rows.length ? draftsResult.rows.map((draft) => { const isSelected = draft.id === reviewDraft; return <article id={`draft-${draft.id}`} className="exception" key={draft.id} style={{ alignItems: "flex-start", scrollMarginTop: 96 }}><div className="grow"><strong>{draft.company_name} · {draft.contact_name || draft.recipient_email}</strong><p className="muted">{draft.contact_title || "Decision-maker"} · fit {draft.qualification_score ?? 0}/100 · {draft.client_company}</p><p><strong>To:</strong> {draft.recipient_email}</p><p><strong>From:</strong> Josh Thomas &lt;josh@mail.arborlineconnect.com&gt;</p><p><strong>Subject:</strong> {draft.subject}</p><p className="muted"><strong>Status:</strong> {draft.status}{isSelected ? " · selected from Live Prospect Pipeline" : ""}</p><div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, marginTop: 12 }}>{draft.body_text}</div><div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}><form action={approveOutreachDraft}><input type="hidden" name="messageId" value={draft.id} /><button type="submit">Approve this draft</button></form><form action={rejectOutreachDraft}><input type="hidden" name="messageId" value={draft.id} /><button type="submit" className="secondary">Reject draft</button></form></div><p className="muted" style={{ marginBottom: 0, marginTop: 10 }}>Approval only moves this specific message into the controlled 9 AM queue. It does not send the prospect email immediately.</p></div><span className="status">{isSelected ? "DRAFT · SELECTED" : draft.status}</span></article>; }) : <div className="empty">No drafts awaiting review.</div>}
      </section>

      <section className="panel" style={{ marginBottom: 12 }}><div className="panelHead"><div><p className="eyebrow">CONTROLLED SEND LAB</p><h3>Test a queued email without contacting the prospect</h3></div><span className="status">Prospect delivery blocked</span></div><p className="muted">The test reruns qualification, exact-recipient and suppression checks, then sends only to the test address. Sender identity is forced to Josh Thomas.</p>{approvedResult.rows.length ? approvedResult.rows.map((row) => <article className="exception" key={row.id} style={{ alignItems: "flex-start" }}><div className="grow"><strong>{row.company_name} · {row.contact_name || row.recipient_email}</strong><p>{row.subject}</p><p className="muted">Intended prospect: {row.recipient_email} · {row.client_company}</p><form action={sendApprovedOutreachTest} className="form" style={{ marginTop: 12 }}><input type="hidden" name="messageId" value={row.id} /><label>Test recipient<input name="testRecipient" type="email" required placeholder="your-email@example.com" /></label><button type="submit">Send controlled test</button></form>{sendReady ? <form action={sendApprovedOutreachLive} style={{ marginTop: 10 }}><input type="hidden" name="messageId" value={row.id}/><button type="submit" className="secondary">Send to approved prospect</button></form> : null}</div><span className="status">QUEUED</span></article>) : <div className="empty">Approve a reviewed draft to enable controlled testing.</div>}</section>

      <section className="panel"><div className="panelHead"><div><p className="eyebrow">CAMPAIGN GUARDRAILS</p><h3>Production sending is compliance-gated</h3></div></div><div className="health"><div><span>Suppression rechecked before send</span><b>Active</b></div><div><span>Signed one-click unsubscribe</span><b>{hasUnsubscribeSecret ? "Ready" : "Blocked"}</b></div><div><span>Physical mailing address footer</span><b>{hasPostalAddress ? "Ready" : "Blocked"}</b></div><div><span>Resend delivery webhooks</span><b>Connected</b></div><div><span>Bounce/complaint auto-stop</span><b>Active</b></div><div><span>Daily rate limit</span><b>{dailyLimit}</b></div><div><span>Bulk approval</span><b>Exact-draft confirmation required</b></div><div><span>Automatic follow-up</span><b>Locked pending pilot validation</b></div></div></section>
    </AppShell>
  );
}
