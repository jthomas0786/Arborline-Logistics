import { AppShell } from "@/app/components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { communicationsConfig } from "@/lib/communications";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

async function getMessages() {
  const { rows } = await getPool().query(
    `SELECT m.id,m.status,m.channel,m.recipient,m.template,m.payload,m.attempts,m.created_at,
            m.provider,m.provider_status,m.accepted_at,m.delivered_at,m.failed_at,m.dead_lettered_at,m.last_error,
            l.reference_number
     FROM outbox_messages m
     LEFT JOIN loads l ON l.id=m.load_id
     ORDER BY m.created_at DESC LIMIT 100`
  );
  return rows;
}

export default async function OutboxPage() {
  await requirePageRole(["STAFF"]);
  const messages = await getMessages();
  const config = communicationsConfig();
  const counts = messages.reduce((acc: Record<string, number>, message) => {
    acc[String(message.status)] = (acc[String(message.status)] ?? 0) + 1;
    return acc;
  }, {});

  return <AppShell active="Outbox">
    <header><div><p className="eyebrow">COMMUNICATIONS</p><h1>Outbound delivery</h1><p className="muted">Carrier offers, driver links and shipper invoices are sent through audited provider-native delivery with retries and callbacks.</p></div></header>
    <section className="grid stats">
      <article className="card"><p>Email</p><h2>{config.emailReady ? "READY" : "SETUP"}</h2><small>{config.emailReady ? "Resend + webhook verification configured" : "Resend credentials/webhook secret required"}</small></article>
      <article className="card"><p>SMS</p><h2>{config.smsReady ? "READY" : "SETUP"}</h2><small>{config.smsReady ? "Twilio + secure status callbacks configured" : "Twilio sender/credentials/callback secret required"}</small></article>
      <article className="card"><p>Delivered</p><h2>{counts.DELIVERED ?? 0}</h2><small>Provider-confirmed deliveries in latest 100</small></article>
      <article className="card"><p>Needs attention</p><h2>{(counts.FAILED ?? 0) + (counts.DEAD_LETTER ?? 0)}</h2><small>Failed or exhausted delivery attempts</small></article>
    </section>
    <section className="panel"><div className="tableWrap"><table><thead><tr><th>Load</th><th>Template</th><th>Channel</th><th>Recipient</th><th>Provider</th><th>Status</th><th>Provider status</th><th>Attempts</th><th>Updated</th><th>Link / error</th></tr></thead><tbody>
      {messages.length === 0 ? <tr><td colSpan={10} className="empty">No outbound messages yet.</td></tr> : messages.map((message) => {
        const path = typeof message.payload?.offerPath === "string" ? message.payload.offerPath
          : typeof message.payload?.invitePath === "string" ? message.payload.invitePath
            : typeof message.payload?.trackingPath === "string" ? message.payload.trackingPath
              : null;
        const when = message.delivered_at ?? message.failed_at ?? message.accepted_at ?? message.created_at;
        return <tr key={message.id}>
          <td>{message.reference_number ?? "—"}</td>
          <td>{message.template}</td>
          <td>{message.channel}</td>
          <td>{message.recipient}</td>
          <td>{message.provider ?? "—"}</td>
          <td><span className={`status ${String(message.status).toLowerCase()}`}>{message.status}</span></td>
          <td>{message.provider_status ?? "—"}</td>
          <td>{message.attempts}</td>
          <td>{when ? new Date(when).toLocaleString() : "—"}</td>
          <td>{path ? <a className="tableLink" href={path}>Open</a> : message.last_error ? <small className="formError">{message.last_error}</small> : "—"}</td>
        </tr>;
      })}
    </tbody></table></div></section>
  </AppShell>;
}
