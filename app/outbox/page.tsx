import { AppShell } from "@/app/components/AppShell";
import { getPool } from "@/lib/db";

async function getMessages() {
  try {
    const { rows } = await getPool().query(`SELECT m.id,m.status,m.channel,m.recipient,m.template,m.payload,m.attempts,m.created_at,l.reference_number FROM outbox_messages m LEFT JOIN loads l ON l.id=m.load_id ORDER BY m.created_at DESC LIMIT 100`);
    return rows;
  } catch { return []; }
}

export default async function OutboxPage() {
  const messages = await getMessages();
  return <AppShell active="Outbox"><header><div><p className="eyebrow">COMMUNICATIONS</p><h1>Outbound queue</h1><p className="muted">Offers wait here until a configured delivery provider confirms they were sent.</p></div></header><section className="panel"><div className="tableWrap"><table><thead><tr><th>Load</th><th>Template</th><th>Channel</th><th>Recipient</th><th>Status</th><th>Attempts</th><th>Carrier link</th></tr></thead><tbody>{messages.length === 0 ? <tr><td colSpan={7} className="empty">No outbound messages yet.</td></tr> : messages.map((message) => { const offerPath = typeof message.payload?.offerPath === "string" ? message.payload.offerPath : null; return <tr key={message.id}><td>{message.reference_number ?? "—"}</td><td>{message.template}</td><td>{message.channel}</td><td>{message.recipient}</td><td><span className={`status ${String(message.status).toLowerCase()}`}>{message.status}</span></td><td>{message.attempts}</td><td>{offerPath ? <a className="tableLink" href={offerPath}>Open offer</a> : "—"}</td></tr>; })}</tbody></table></div></section></AppShell>;
}
