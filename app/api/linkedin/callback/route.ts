import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { discoverLinkedInIdentity, encryptLinkedInToken, exchangeLinkedInCode, linkedinOAuthConfig } from "@/lib/linkedin";

export const dynamic = "force-dynamic";

function redirectToAgents(request: NextRequest, value: string) {
  const publicBase = (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://arborlineconnect.com").replace(/\/$/, "");
  const url = new URL("/agents", publicBase);
  url.searchParams.set("linkedin", value);
  const response = NextResponse.redirect(url);
  response.cookies.delete("arborline_linkedin_oauth_state");
  return response;
}

export async function GET(request: NextRequest) {
  const auth = await requireApiRole(["STAFF"]);
  if (!auth.identity) return redirectToAgents(request, "auth-required");

  const state = request.nextUrl.searchParams.get("state") || "";
  const expectedState = request.cookies.get("arborline_linkedin_oauth_state")?.value || "";
  const code = request.nextUrl.searchParams.get("code") || "";
  const oauthError = request.nextUrl.searchParams.get("error");

  if (oauthError || !state || !expectedState || state !== expectedState || !code) {
    return redirectToAgents(request, "error");
  }

  try {
    const config = linkedinOAuthConfig(request.nextUrl.origin);
    const token = await exchangeLinkedInCode(config, code);
    const encrypted = encryptLinkedInToken(token.accessToken);
    const pool = getPool();
    const clientResult = await pool.query(
      "SELECT id FROM connect_clients WHERE lower(company_name)=lower('ArborLine Connect') ORDER BY created_at LIMIT 1"
    );
    const clientId = clientResult.rows[0]?.id as string | undefined;
    if (!clientId) throw new Error("ArborLine Connect internal client is missing.");

    const expiresAt = new Date(Date.now() + token.expiresIn * 1000);
    const discoveredIdentity = await discoverLinkedInIdentity(token.accessToken);
    const memberUrn = process.env.LINKEDIN_PERSON_URN?.trim() || discoveredIdentity.memberUrn || null;
    const organizationUrn = process.env.LINKEDIN_ORGANIZATION_URN?.trim() || discoveredIdentity.organizationUrn || null;

    await pool.query(
      "INSERT INTO connect_linkedin_connections (client_id,encrypted_access_token,token_iv,token_tag,scopes,member_urn,organization_urn,expires_at,status,last_error,authorized_at,updated_at) VALUES ($1,$2,$3,$4,$5::text[],$6,$7,$8,'ACTIVE',NULL,now(),now()) ON CONFLICT (client_id) DO UPDATE SET encrypted_access_token=excluded.encrypted_access_token,token_iv=excluded.token_iv,token_tag=excluded.token_tag,scopes=excluded.scopes,member_urn=excluded.member_urn,organization_urn=excluded.organization_urn,expires_at=excluded.expires_at,status='ACTIVE',last_error=NULL,authorized_at=now(),updated_at=now()",
      [clientId, encrypted.encrypted, encrypted.iv, encrypted.tag, token.scopes, memberUrn, organizationUrn, expiresAt]
    );
    await pool.query(
      "INSERT INTO connect_agent_events (client_id,agent_key,event_type,status,summary,metrics) VALUES ($1,'LINKEDIN_PUBLISHER','OAUTH_CONNECTED','SUCCESS','LinkedIn authorization connected to ArborLine.', $2::jsonb)",
      [clientId, JSON.stringify({
        scopes: token.scopes,
        expires_at: expiresAt.toISOString(),
        member_urn_discovered: Boolean(memberUrn),
        organization_urn_discovered: Boolean(organizationUrn),
        organization_name: discoveredIdentity.organizationName,
        discovery_status: discoveredIdentity.discoveryStatus
      })]
    );
    return redirectToAgents(request, "connected");
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "LinkedIn authorization failed.";
    try {
      const pool = getPool();
      const clientResult = await pool.query(
        "SELECT id FROM connect_clients WHERE lower(company_name)=lower('ArborLine Connect') ORDER BY created_at LIMIT 1"
      );
      if (clientResult.rows[0]?.id) {
        await pool.query(
          "INSERT INTO connect_agent_events (client_id,agent_key,event_type,status,summary) VALUES ($1,'LINKEDIN_PUBLISHER','OAUTH_FAILED','ERROR',$2)",
          [clientResult.rows[0].id, message]
        );
      }
    } catch {
      // Preserve the original OAuth failure.
    }
    return redirectToAgents(request, "error");
  }
}
