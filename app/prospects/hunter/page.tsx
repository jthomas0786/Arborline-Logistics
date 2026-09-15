import Link from "next/link";
import { AppShell } from "@/app/components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { getHunterAccountSummary, hunterConfigured, HunterApiError } from "@/lib/connect-hunter";
import { runHunterLookup } from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function numberParam(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function usageRemaining(bucket: { remaining?: number | null } | null | undefined) {
  return typeof bucket?.remaining === "number" ? bucket.remaining : null;
}

export default async function HunterProspectsPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePageRole(["STAFF"]);
  const params = await searchParams;
  const pool = getPool();
  const configured = hunterConfigured();

  let account: Awaited<ReturnType<typeof getHunterAccountSummary>> | null = null;
  let accountError: string | null = null;
  if (configured) {
    try {
      account = await getHunterAccountSummary();
    } catch (error) {
      accountError = error instanceof HunterApiError
        ? `Hunter rejected the connection (${error.status}).`
        : "Hunter connection check failed.";
    }
  }

  const prospectsResult = await pool.query(`
    SELECT p.id,p.client_id,p.company_name,p.domain,p.contact_name,p.contact_title,p.contact_email,
           p.qualification_score,p.qualification_status,p.enrichment_status,p.outreach_status,
           p.suppression_status,p.source_metadata,p.created_at,
           c.company_name AS client_company,
           s.name AS segment_name
    FROM connect_prospects p
    JOIN connect_clients c ON c.id=p.client_id
    LEFT JOIN connect_prospect_segments s ON s.id=p.segment_id
    WHERE p.qualification_status='QUALIFIED'
      AND p.suppression_status='CLEAR'
      AND p.contact_email IS NULL
      AND p.domain IS NOT NULL
      AND p.contact_name IS NOT NULL
    ORDER BY p.qualification_score DESC,p.created_at ASC
    LIMIT 100
  `);

  const hunterState = typeof params.hunter === "string" ? params.hunter : null;
  const providerCode = typeof params.code === "string" ? params.code : null;
  const resultScore = numberParam(params.score);
  const resultCredits = numberParam(params.credits);
  const resultMinimum = numberParam(params.minimum);

  const message = hunterState === "found"
    ? `Hunter found and saved the decision-maker email${resultScore !== null ? ` at ${resultScore}% confidence` : ""}. The prospect is now outreach-ready after the safety checks.`
    : hunterState === "not_found"
      ? "Hunter did not find a professional email. No prospect data was promoted to outreach-ready."
      : hunterState === "low_confidence"
        ? `Hunter returned an address, but confidence${resultScore !== null ? ` was ${resultScore}%` : ""}${resultMinimum !== null ? `, below the ${resultMinimum}% minimum` : ""}. ArborLine did not save it as the contact email.`
        : hunterState === "domain_mismatch"
          ? "Hunter returned an address that did not match the company domain. ArborLine rejected it."
          : hunterState === "suppressed"
            ? "Hunter found an address, but the suppression recheck blocked outreach and stopped the prospect."
            : hunterState === "auth_error"
              ? "Hunter rejected the API credentials. Recheck HUNTER_API_KEY in the Production environment."
              : hunterState === "finder_restricted"
                ? "Hunter reports available credits, but Email Finder rejected this API key's request. No email was saved and no Finder credit was charged."
                : hunterState === "usage_limit"
                  ? "Hunter says this account has reached its current usage or credit limit. No email was saved."
                  : hunterState === "rate_limited"
                    ? "Hunter temporarily throttled the request rate. No email was saved; wait a moment before trying again."
                    : hunterState === "provider_error"
                      ? "Hunter returned a provider error. No email was saved."
                      : hunterState === "ineligible"
                        ? "That prospect is no longer eligible for a Hunter lookup."
                        : null;

  const unifiedCredits = usageRemaining(account?.credits);
  const searchCredits = usageRemaining(account?.searches);
  const verificationCredits = usageRemaining(account?.verifications);
  const finderCredits = unifiedCredits ?? searchCredits;
  const finderAvailable = Boolean(account?.connected) && (finderCredits === null || finderCredits > 0);

  return (
    <AppShell active="Prospects">
      <header>
        <div>
          <p className="eyebrow">DECISION-MAKER ENRICHMENT</p>
          <h1>Hunter Email Finder</h1>
          <p className="muted">Use Hunter manually on one qualified prospect at a time before handing this step to the Decision-Maker.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="button" href="/prospects?lane=not-ready">Back to Not Ready</Link>
          <Link className="button" href="/campaigns">Campaigns</Link>
        </div>
      </header>

      {message ? (
        <section className="panel" style={{ marginBottom: 12 }}>
          <strong>{message}</strong>
          {hunterState === "finder_restricted" ? <p className="muted" style={{ marginBottom: 0 }}>ArborLine is using Hunter&apos;s documented X-API-KEY authentication and first/last-name Finder parameters. If Hunter still returns 429 while credits remain, the API key or its Hunter member has a Finder usage restriction.</p> : null}
          {hunterState === "usage_limit" ? <p className="muted" style={{ marginBottom: 0 }}>Hunter uses HTTP 429 for a usage/credit limit, not for normal request-speed throttling. Check the credit balance below before retrying.</p> : null}
          {providerCode ? <p className="muted" style={{ marginBottom: 0 }}>Hunter error code: {providerCode}</p> : null}
          {resultCredits !== null ? <p className="muted" style={{ marginBottom: 0 }}>Hunter reported {resultCredits} credit{resultCredits === 1 ? "" : "s"} charged for that lookup.</p> : null}
        </section>
      ) : null}

      <section className="grid stats">
        <article className="card"><p>Hunter key</p><h2>{configured ? "ADDED" : "MISSING"}</h2><small>Stored server-side only</small></article>
        <article className="card"><p>API connection</p><h2>{account?.connected ? "CONNECTED" : accountError ? "ERROR" : "—"}</h2><small>{account?.planName ? `${account.planName} plan` : accountError || "Waiting for configuration"}</small></article>
        <article className="card"><p>Credits remaining</p><h2>{unifiedCredits ?? searchCredits ?? "—"}</h2><small>{unifiedCredits !== null ? "Unified Hunter credits" : searchCredits !== null ? "Search credits" : "Usage unavailable"}</small></article>
        <article className="card"><p>Eligible gaps</p><h2>{prospectsResult.rows.length}</h2><small>Qualified + named decision-maker + domain + no email</small></article>
      </section>

      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panelHead">
          <div><p className="eyebrow">CONNECTION</p><h3>Hunter account status</h3></div>
          <span className="status">{account?.connected ? (finderCredits === 0 ? "NO CREDITS" : "READY") : configured ? "CHECK FAILED" : "NOT CONFIGURED"}</span>
        </div>
        <div className="health">
          <div><span>Plan</span><b>{account?.planName || "—"}</b></div>
          <div><span>Unified credits remaining</span><b>{unifiedCredits ?? "—"}</b></div>
          <div><span>Search credits remaining</span><b>{searchCredits ?? "—"}</b></div>
          <div><span>Verification credits remaining</span><b>{verificationCredits ?? "—"}</b></div>
          <div><span>Reset date</span><b>{account?.resetDate || "—"}</b></div>
          <div><span>Automatic Hunter spend</span><b>OFF</b></div>
        </div>
        <p className="muted" style={{ marginBottom: 0, marginTop: 12 }}>The account check is read-only. Hunter usage/account checks do not consume Finder credits. Email Finder runs only when you click a prospect below.</p>
      </section>

      <section className="panel">
        <div className="panelHead">
          <div><p className="eyebrow">MANUAL FIRST RUN</p><h3>Qualified prospects missing a buyer email</h3></div>
          <span className="status">NO AUTO-RUNS</span>
        </div>
        <p className="muted">Each click uses the already-researched decision-maker name plus the company domain. A successful Finder result can cost up to one Hunter search credit. ArborLine then checks confidence, company-domain match, and suppression before saving it. This action does not create a draft, approve a draft, queue a message, or send email.</p>

        {prospectsResult.rows.length ? (
          <div className="tableWrap">
            <table>
              <thead><tr><th>Company</th><th>Decision-maker</th><th>Client / segment</th><th>Fit</th><th>Status</th><th>Hunter action</th></tr></thead>
              <tbody>
                {prospectsResult.rows.map((row) => {
                  const hunter = row.source_metadata?.hunter_email_finder;
                  return (
                    <tr key={row.id}>
                      <td><strong>{row.company_name}</strong><div className="muted">{row.domain}</div></td>
                      <td>{row.contact_name}<div className="muted">{row.contact_title || "Decision-maker"}</div></td>
                      <td>{row.client_company}<div className="muted">{row.segment_name || "Core ICP"}</div></td>
                      <td><strong>{row.qualification_score ?? 0}/100</strong></td>
                      <td><span className="status">{hunter?.status ? `HUNTER ${hunter.status}` : "EMAIL MISSING"}</span><div className="muted">{row.enrichment_status} · {row.outreach_status}</div></td>
                      <td>
                        <form action={runHunterLookup}>
                          <input type="hidden" name="prospectId" value={row.id} />
                          <button type="submit" disabled={!finderAvailable}>{finderCredits === 0 ? "No Hunter credits remaining" : "Find email · up to 1 credit"}</button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <div className="empty">No qualified prospects currently need a Hunter email lookup.</div>}
      </section>
    </AppShell>
  );
}
