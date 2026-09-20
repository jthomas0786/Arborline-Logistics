import { randomBytes } from "node:crypto";
import { resolveMx } from "node:dns/promises";
import { connect as netConnect, Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";

const BASE_URL = (process.env.ARBORLINE_BASE_URL || "https://www.arborlineconnect.com").replace(/\/$/, "");
const TOKEN = process.env.ARBORLINE_OIDC_TOKEN || "";
const WORKER_ID = process.env.ARBORLINE_MAILBOX_WORKER_ID || `github-${process.env.GITHUB_RUN_ID || "manual"}`;
const LANE = String(process.env.ARBORLINE_MAILBOX_LANE || "fresh").toLowerCase() === "retry" ? "retry" : "fresh";
const MAX_CANDIDATES = Math.max(1, Math.min(5, Number(process.env.ARBORLINE_MAILBOX_MAX || 3)));
const TIMEOUT_MS = 9_000;
const HELO = "mail.arborlineconnect.com";
const MAIL_FROM = "josh@mail.arborlineconnect.com";

if (!TOKEN) throw new Error("ARBORLINE_OIDC_TOKEN is required.");

function clean(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " | ").replace(/\s+/g, " ").trim().slice(0, 500);
}

function readResponse(socket, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => fail(new Error("SMTP_RESPONSE_TIMEOUT")), timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", fail);
      socket.off("close", onClose);
    };
    const fail = (error) => { cleanup(); reject(error); };
    const onClose = () => fail(new Error("SMTP_CONNECTION_CLOSED"));
    const onData = (chunk) => {
      buffer += chunk.toString();
      for (const line of buffer.split(/\r?\n/).filter(Boolean)) {
        const match = line.match(/^(\d{3})([ -])/);
        if (!match || match[2] !== " ") continue;
        cleanup();
        resolve({ code: Number(match[1]), text: clean(buffer) });
        return;
      }
    };
    socket.on("data", onData);
    socket.once("error", fail);
    socket.once("close", onClose);
  });
}

async function command(socket, value) {
  await new Promise((resolve, reject) => socket.write(`${value}\r\n`, (error) => error ? reject(error) : resolve()));
  return readResponse(socket);
}

async function openSmtp(host) {
  const socket = netConnect({ host, port: 25 });
  socket.setKeepAlive(false);
  socket.setNoDelay(true);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("SMTP_CONNECT_TIMEOUT"));
    }, TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("connect", onConnect);
      socket.off("error", onError);
    };
    const onConnect = () => { cleanup(); resolve(); };
    const onError = (error) => { cleanup(); reject(error); };
    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
  const banner = await readResponse(socket);
  if (banner.code < 200 || banner.code >= 400) {
    socket.destroy();
    throw new Error(`SMTP_BANNER_${banner.code}`);
  }
  return socket;
}

async function maybeStartTls(socket, host, ehlo) {
  if (!/\bSTARTTLS\b/i.test(ehlo.text)) return { socket, tlsUsed: false, ehlo };
  const start = await command(socket, "STARTTLS");
  if (start.code !== 220) return { socket, tlsUsed: false, ehlo };
  const tlsSocket = tlsConnect({ socket, servername: host, rejectUnauthorized: true });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      tlsSocket.destroy();
      reject(new Error("SMTP_TLS_TIMEOUT"));
    }, TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timer);
      tlsSocket.off("secureConnect", onSecure);
      tlsSocket.off("error", onError);
    };
    const onSecure = () => { cleanup(); resolve(); };
    const onError = (error) => { cleanup(); reject(error); };
    tlsSocket.once("secureConnect", onSecure);
    tlsSocket.once("error", onError);
  });
  return { socket: tlsSocket, tlsUsed: true, ehlo: await command(tlsSocket, `EHLO ${HELO}`) };
}

async function mxHosts(domain) {
  const records = await Promise.race([
    resolveMx(domain),
    new Promise((_, reject) => setTimeout(() => reject(new Error("MX_TIMEOUT")), 4_000))
  ]);
  return records.filter((row) => row.exchange).sort((a, b) => a.priority - b.priority).map((row) => row.exchange.toLowerCase()).slice(0, 2);
}

async function probe(email, domain) {
  const started = Date.now();
  let hosts;
  try {
    hosts = await mxHosts(domain);
  } catch (error) {
    return { duration_ms: Date.now() - started, network_error: clean(error?.message || error), mx_host: null };
  }
  if (!hosts.length) return { duration_ms: Date.now() - started, network_error: "NO_MX_HOST", mx_host: null };

  let lastError = null;
  for (const host of hosts) {
    let socket = null;
    let tlsUsed = false;
    try {
      socket = await openSmtp(host);
      let ehlo = await command(socket, `EHLO ${HELO}`);
      if (ehlo.code >= 400) ehlo = await command(socket, `HELO ${HELO}`);
      if (ehlo.code >= 400) throw new Error(`EHLO_${ehlo.code}`);

      if (/\bSTARTTLS\b/i.test(ehlo.text) && socket instanceof Socket) {
        const upgraded = await maybeStartTls(socket, host, ehlo);
        socket = upgraded.socket;
        tlsUsed = upgraded.tlsUsed;
        ehlo = upgraded.ehlo;
      }

      const mail = await command(socket, `MAIL FROM:<${MAIL_FROM}>`);
      if (mail.code < 200 || mail.code >= 400) {
        return { mx_host: host, tls_used: tlsUsed, duration_ms: Date.now() - started, target_code: mail.code, target_text: mail.text };
      }

      const target = await command(socket, `RCPT TO:<${email}>`);
      let control = { code: null, text: "" };
      if (target.code === 250 || target.code === 251) {
        await command(socket, "RSET").catch(() => null);
        const secondMail = await command(socket, `MAIL FROM:<${MAIL_FROM}>`);
        if (secondMail.code === 250 || secondMail.code === 251) {
          const impossible = `arborline-verify-${randomBytes(12).toString("hex")}@${domain}`;
          control = await command(socket, `RCPT TO:<${impossible}>`);
        } else {
          control = secondMail;
        }
      }

      try { socket.write("QUIT\r\n"); } catch {}
      socket.destroy();
      return {
        mx_host: host,
        tls_used: tlsUsed,
        duration_ms: Date.now() - started,
        target_code: target.code,
        target_text: target.text,
        control_code: control.code,
        control_text: control.text
      };
    } catch (error) {
      lastError = error;
      try { if (socket && !socket.destroyed) socket.destroy(); } catch {}
    }
  }
  return { mx_host: hosts[0] || null, tls_used: false, duration_ms: Date.now() - started, network_error: clean(lastError?.message || lastError || "SMTP_PROBE_FAILED") };
}

async function api(body) {
  const response = await fetch(`${BASE_URL}/api/cron/connect-mailbox-worker`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "user-agent": "ArborLine-GitHub-Mailbox/1.0",
      "x-arborline-mailbox-worker": WORKER_ID
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000)
  });
  const parsed = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Mailbox coordinator ${response.status}: ${clean(parsed?.error || "request failed")}`);
  return parsed;
}

let processed = 0;
for (let index = 0; index < MAX_CANDIDATES; index++) {
  const claimed = await api({ action: "claim", lane: LANE });
  const candidate = claimed?.candidate;
  if (!candidate) break;
  const result = await probe(candidate.email, candidate.domain);
  await api({ action: "result", candidate_id: candidate.candidateId, claim_id: candidate.claimId || undefined, ...result });
  processed++;
}

console.log(`ArborLine mailbox ${LANE} worker completed ${processed} candidate probe${processed === 1 ? "" : "s"}.`);
