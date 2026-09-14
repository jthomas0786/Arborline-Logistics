import { redirect } from "next/navigation";
import { AppShell } from "../../../components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { sampleDeliveryConfigured, sampleShareUrl } from "@/lib/connect-free-sample-delivery";
import {
  approveFreeSampleMatches,
  reopenFreeSampleMatches,
  saveFreeSampleEmailDraft,
  sendApprovedFreeSample,
  setFreeSampleMatchSelected,
  updateFreeSampleConversionStatus
} from "../actions";

export const dynamic = "force-dynamic";

function formatWhen(value: unknown) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(String(value)));
  } catch {
    return String(value);
  }
}

function label(value: unknown) {
  return String(value || "").replaceAll("_", " ");
}

function externalUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function reasons(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean).slice(0, 5) : [];
}

export default async function FreeSampleDeliveryPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string,string|string[]|undefined>>;
}) {
  await requirePageRole(["STAFF"]);
  const { id } = await params;
  const notices = await searchParams;
  const notice = Array.isArray(notices.status) ? notices.status[0] : notices.status;
  const pool = getPool();
  const config = sampleDeliveryConfigured();

  const [requestResult, matchesResult] = await Promise.all([
    pool.query(`SELECT id,name,work_email,company_name,industry,service_area,website,notes,target_customer,
      decision_maker_titles,sample_status,sample_prepared_at,sample_delivered_at,sample_provider,
      sample_generated_at,sample_approved_at,sample_share_token,sample_email_subject,sample_email_body,
      sample_email_status,sample_email_approved_at,sample_email_sent_at,sample_email_provider_message_id,
      sample_email_error,sample_viewed_at,sample_view_count,sample_conversion_status,sample_conversion_updated_at,
      created_at,updated_at
      FROM connect_pilot_interest
      WHERE id=$1 AND request_type='FREE_SAMPLE'
      LIMIT 1`, [id]),
    pool.query(`SELECT id,request_id,rank,company_name,website,domain,industry,city,state,country,
      employee_count,source,source_url,match_score,match_reasons,selected,created_at,updated_at
      FROM connect_free_sample_matches
      WHERE request_id=$1
      ORDER BY rank`, [id])
  ]);

  const request = requestResult.rows[0];
  if (!request) redirect("/growth/samples?status=invalid");

  const selectedMatches = matchesResult.rows.filter(match => match.selected);
  const approved = Boolean(request.sample_approved_at);
  const sent = request.sample_email_status === "SENT";
  const sending = request.sample_email_status === "SENDING";
  const shareUrl = request.sample_share_token ? sampleShareUrl(String(request.sample_share_token)) : null;
  const requesterWebsite = externalUrl(request.website);

  return <AppShell active="Samples">
    <header>
      <div><p className="eyebrow">SAMPLE DELIVERY</p><h1>{request.company_name}</h1><p className="muted">Review the final companies, lock the sample, edit the delivery email, then send it with one explicit staff action.</p></div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><a className="button" href="/growth/samples">Back to samples</a>{requesterWebsite ? <a className="button" href={requesterWebsite} target="_blank" rel="noreferrer">Requester website</a> : null}</div>
    </header>

    {notice === "approved" ? <div className="notice"><strong>Final matches approved.</strong> The private sample link and delivery email draft are ready. Nothing was sent.</div> : null}
    {notice === "email_saved" ? <div className="notice"><strong>Email draft saved.</strong> Nothing was sent.</div> : null}
    {notice === "email_locked" ? <div className="notice"><strong>Email editing is locked.</strong> A sample that is sending or already sent cannot be changed.</div> : null}
    {notice === "email_invalid" ? <div className="notice"><strong>Email draft needs a subject and body.</strong></div> : null}
    {notice === "delivery_locked" ? <div className="notice"><strong>Sample delivery is locked.</strong> The independent delivery switch and Resend configuration must both be ready.</div> : null}
    {notice === "delivery_blocked" ? <div className="notice"><strong>Sample delivery was blocked.</strong> Check approval, recipient, private link, and email draft.</div> : null}
    {notice === "already_sending" ? <div className="notice"><strong>This sample is already being sent.</strong> The duplicate send was blocked.</div> : null}
    {notice === "delivery_failed" ? <div className="notice"><strong>Delivery failed safely.</strong> Review the error below before retrying.</div> : null}
    {notice === "sent" ? <div className="notice"><strong>Sample sent.</strong> The request is now tracked as delivered.</div> : null}
    {notice === "conversion_updated" ? <div className="notice"><strong>Conversion stage updated.</strong></div> : null}

    <section className="grid stats">
      <article className="card"><p>Selected</p><h2>{selectedMatches.length}</h2><small>Final sample companies</small></article>
      <article className="card"><p>Approval</p><h2>{approved ? "Locked" : "Open"}</h2><small>{approved ? formatWhen(request.sample_approved_at) : "Choose 3–5 matches"}</small></article>
      <article className="card"><p>Delivery</p><h2>{label(request.sample_email_status)}</h2><small>{formatWhen(request.sample_email_sent_at)}</small></article>
      <article className="card"><p>Sample opens</p><h2>{request.sample_view_count || 0}</h2><small>{request.sample_viewed_at ? `First seen ${formatWhen(request.sample_viewed_at)}` : "No recorded opens"}</small></article>
      <article className="card"><p>Conversion</p><h2>{label(request.sample_conversion_status)}</h2><small>{formatWhen(request.sample_conversion_updated_at)}</small></article>
    </section>

    <section className="split" style={{marginBottom:12}}>
      <article className="panel">
        <div className="panelHead"><div><p className="eyebrow">REQUESTER</p><h3>{request.name}</h3></div><span className="status">{request.work_email}</span></div>
        <div className="health">
          <div><span>Company</span><b>{request.company_name}</b></div>
          <div><span>Industry</span><b>{request.industry || "Not specified"}</b></div>
          <div><span>Target geography</span><b>{request.service_area || "Not specified"}</b></div>
          <div><span>Decision makers</span><b>{request.decision_maker_titles || "Not specified"}</b></div>
          <div><span>Requested</span><b>{formatWhen(request.created_at)}</b></div>
          <div><span>Generated</span><b>{formatWhen(request.sample_generated_at)}</b></div>
        </div>
        <p><strong>Ideal customer:</strong> {request.target_customer}</p>
        {request.notes ? <p><strong>Extra notes:</strong> {request.notes}</p> : null}
      </article>

      <article className="panel">
        <div className="panelHead"><div><p className="eyebrow">DELIVERY SAFETY</p><h3>Explicit send only</h3></div><span className="status">{config.ready ? "Ready" : "Locked"}</span></div>
        <div className="health">
          <div><span>Delivery switch</span><b>{config.enabled ? "ON" : "OFF"}</b></div>
          <div><span>Resend</span><b>{config.resend ? "Configured" : "Missing"}</b></div>
          <div><span>Auto-send</span><b>Never</b></div>
          <div><span>Campaign enrollment</span><b>Never</b></div>
          <div><span>Sample companies contacted</span><b>Never</b></div>
          <div><span>Duplicate send guard</span><b>Idempotent + SENDING lock</b></div>
        </div>
      </article>
    </section>

    <section className="panel" style={{marginBottom:12}}>
      <div className="panelHead"><div><p className="eyebrow">FINAL MATCHES</p><h3>Approve the 3–5 companies the requester will see</h3></div><span className="status">{approved ? "LOCKED" : `${selectedMatches.length} selected`}</span></div>
      <div style={{display:"grid",gap:8}}>{matchesResult.rows.map(match => {
        const website = externalUrl(match.website || match.domain);
        return <div className="exception" key={match.id} style={{alignItems:"flex-start",opacity:match.selected ? 1 : .55}}>
          <span className={`severity ${Number(match.match_score) >= 70 ? "docs" : "review"}`}>#{match.rank} · {match.match_score}</span>
          <div className="grow"><strong>{match.company_name}</strong><p>{[match.industry,match.city,match.state,match.employee_count ? `${match.employee_count} employees` : null].filter(Boolean).join(" · ") || "Company details limited"}</p><small className="muted">{reasons(match.match_reasons).join(" · ")}</small></div>
          <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>{website ? <a className="button" href={website} target="_blank" rel="noreferrer">Website</a> : null}{!approved ? <form action={setFreeSampleMatchSelected}><input type="hidden" name="requestId" value={request.id}/><input type="hidden" name="matchId" value={match.id}/><input type="hidden" name="selected" value={match.selected ? "false" : "true"}/><button type="submit">{match.selected ? "Exclude" : "Include"}</button></form> : null}</div>
        </div>;
      })}</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:14}}>
        {!approved ? <form action={approveFreeSampleMatches}><input type="hidden" name="id" value={request.id}/><button type="submit" disabled={selectedMatches.length < 3 || selectedMatches.length > 5}>Approve final {selectedMatches.length} matches</button></form> : null}
        {approved && !sent && !sending ? <form action={reopenFreeSampleMatches}><input type="hidden" name="id" value={request.id}/><button type="submit">Reopen match selection</button></form> : null}
        {approved ? <a className="button" href={`/growth/samples/${request.id}/preview`} target="_blank" rel="noreferrer">Staff preview</a> : null}
        {shareUrl ? <a className="button" href={shareUrl} target="_blank" rel="noreferrer">Open private customer link</a> : null}
      </div>
      {!approved ? <small className="muted">Approval locks selection and generates the private share link plus delivery email draft. It does not send anything.</small> : <small className="muted">Selection is locked so the email and customer-facing sample cannot drift apart.</small>}
    </section>

    <section className="split" style={{marginBottom:12}}>
      <article className="panel">
        <div className="panelHead"><div><p className="eyebrow">DELIVERY EMAIL</p><h3>Preview and edit before sending</h3></div><span className="status">{label(request.sample_email_status)}</span></div>
        {!approved ? <p className="muted">Approve the final matches first. ArborLine will then generate the delivery draft automatically.</p> : <form action={saveFreeSampleEmailDraft} style={{display:"grid",gap:12}}>
          <input type="hidden" name="id" value={request.id}/>
          <label>Subject<input name="subject" defaultValue={request.sample_email_subject || ""} maxLength={180} required disabled={sent || sending}/></label>
          <label>Message<textarea name="body" defaultValue={request.sample_email_body || ""} rows={18} maxLength={6000} required disabled={sent || sending}/></label>
          {!sent && !sending ? <button type="submit">Save email draft</button> : null}
        </form>}
        {request.sample_email_error ? <div className="notice" style={{marginTop:12}}><strong>Last delivery error:</strong> {request.sample_email_error}</div> : null}
      </article>

      <article className="panel">
        <div className="panelHead"><div><p className="eyebrow">SEND & CONVERT</p><h3>One controlled fulfillment action</h3></div><span className="status">{sent ? "SENT" : config.ready ? "READY" : "LOCKED"}</span></div>
        <p className="muted">The recipient is the person who explicitly requested this sample: <strong>{request.work_email}</strong>. Sending does not contact any company listed in the sample.</p>
        <div className="health">
          <div><span>Approved</span><b>{formatWhen(request.sample_approved_at)}</b></div>
          <div><span>Sent</span><b>{formatWhen(request.sample_email_sent_at)}</b></div>
          <div><span>Provider id</span><b>{request.sample_email_provider_message_id || "—"}</b></div>
          <div><span>Private link</span><b>{shareUrl ? "Ready" : "Not created"}</b></div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}>
          {approved && !sent ? <form action={sendApprovedFreeSample}><input type="hidden" name="id" value={request.id}/><button type="submit" disabled={!config.ready || sending}>{sending ? "Sending…" : "Send sample to requester"}</button></form> : null}
          {shareUrl ? <a className="button" href={shareUrl} target="_blank" rel="noreferrer">Preview customer experience</a> : null}
        </div>
        <hr style={{border:0,borderTop:"1px solid rgba(143,174,211,.15)",margin:"24px 0"}}/>
        <p className="eyebrow">CONVERSION STAGE</p>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{["OPEN","INTERESTED","NOT_NOW","CONVERTED","CLOSED"].map(status => <form action={updateFreeSampleConversionStatus} key={status}><input type="hidden" name="id" value={request.id}/><input type="hidden" name="status" value={status}/><button type="submit" disabled={request.sample_conversion_status === status}>{label(status)}</button></form>)}</div>
        <small className="muted">These controls only track the sales outcome. They do not send follow-ups or create a paid subscription.</small>
      </article>
    </section>
  </AppShell>;
}
