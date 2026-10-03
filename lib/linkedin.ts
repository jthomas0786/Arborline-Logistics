import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const LINKEDIN_AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const LINKEDIN_POSTS_URL = "https://api.linkedin.com/rest/posts";
const LINKEDIN_ORG_ACLS_URL = "https://api.linkedin.com/rest/organizationAcls";
const LINKEDIN_USERINFO_URL = "https://api.linkedin.com/v2/userinfo";

export function linkedinOAuthConfig(origin?: string) {
  const clientId = process.env.LINKEDIN_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET?.trim() ?? "";
  const base = (process.env.APP_BASE_URL || origin || "").replace(/\/$/, "");
  const redirectUri = process.env.LINKEDIN_REDIRECT_URI?.trim() || (base ? base + "/api/linkedin/callback" : "");
  const scopes = (process.env.LINKEDIN_OAUTH_SCOPES || "openid profile email w_member_social")
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("LinkedIn OAuth is not configured.");
  }
  return { clientId, clientSecret, redirectUri, scopes };
}

function tokenKey() {
  const secret = process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY?.trim();
  if (!secret || secret.length < 32) throw new Error("LINKEDIN_TOKEN_ENCRYPTION_KEY must be at least 32 characters.");
  return createHash("sha256").update(secret).digest();
}

export function encryptLinkedInToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    encrypted: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64")
  };
}

export function decryptLinkedInToken(input: { encrypted: string; iv: string; tag: string }) {
  const decipher = createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(input.iv, "base64"));
  decipher.setAuthTag(Buffer.from(input.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(input.encrypted, "base64")),
    decipher.final()
  ]).toString("utf8");
}

export function createLinkedInAuthorizationUrl(config: ReturnType<typeof linkedinOAuthConfig>, state: string) {
  const url = new URL(LINKEDIN_AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", config.scopes.join(" "));
  return url;
}

export async function exchangeLinkedInCode(config: ReturnType<typeof linkedinOAuthConfig>, code: string) {
  const response = await fetch(LINKEDIN_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret
    }),
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({})) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error("LinkedIn token exchange failed (" + response.status + "): " + (payload.error_description || payload.error || "unknown error"));
  }
  return {
    accessToken: payload.access_token,
    expiresIn: Math.max(60, Number(payload.expires_in || 3600)),
    scopes: (payload.scope || config.scopes.join(" ")).split(/\s+/).filter(Boolean)
  };
}


export async function discoverLinkedInIdentity(accessToken: string) {
  const version = process.env.LINKEDIN_API_VERSION || "202609";
  const headers = {
    Authorization: "Bearer " + accessToken,
    "Linkedin-Version": version,
    "X-Restli-Protocol-Version": "2.0.0",
    Accept: "application/json"
  };

  try {
    const url = new URL(LINKEDIN_ORG_ACLS_URL);
    url.searchParams.set("q", "roleAssignee");
    url.searchParams.set("state", "APPROVED");
    url.searchParams.set("count", "100");

    const response = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      return { memberUrn: null, organizationUrn: null, organizationName: null, discoveryStatus: "acl_unavailable_" + response.status };
    }

    const payload = await response.json().catch(() => ({})) as {
      elements?: Array<{
        roleAssignee?: string;
        organization?: string;
        organizationTarget?: string;
        state?: string;
      }>;
    };

    const elements = Array.isArray(payload.elements) ? payload.elements : [];
    const memberUrn = elements
      .map((row) => row.roleAssignee)
      .find((value): value is string => /^urn:li:person:[^\s]+$/i.test(String(value || ""))) || null;

    const organizationUrns = [...new Set(
      elements
        .map((row) => row.organization || row.organizationTarget || "")
        .filter((value) => /^urn:li:organization:\d+$/i.test(value))
    )];

    if (!organizationUrns.length) {
      return { memberUrn, organizationUrn: null, organizationName: null, discoveryStatus: "no_administered_organization" };
    }

    if (organizationUrns.length === 1) {
      return { memberUrn, organizationUrn: organizationUrns[0], organizationName: null, discoveryStatus: "single_administered_organization" };
    }

    const organizations = await Promise.all(organizationUrns.map(async (urn) => {
      const id = urn.split(":").pop() || "";
      try {
        const detail = await fetch("https://api.linkedin.com/rest/organizations/" + encodeURIComponent(id), {
          headers,
          cache: "no-store",
          signal: AbortSignal.timeout(8_000)
        });
        if (!detail.ok) return { urn, name: "" };
        const body = await detail.json().catch(() => ({})) as { localizedName?: string; vanityName?: string };
        return { urn, name: String(body.localizedName || body.vanityName || "") };
      } catch {
        return { urn, name: "" };
      }
    }));

    const arborLine = organizations.find((row) => /arbor\s*line/i.test(row.name));
    return {
      memberUrn,
      organizationUrn: arborLine?.urn || null,
      organizationName: arborLine?.name || null,
      discoveryStatus: arborLine ? "matched_arborline" : "multiple_administered_organizations"
    };
  } catch {
    return { memberUrn: null, organizationUrn: null, organizationName: null, discoveryStatus: "discovery_failed" };
  }
}

export async function publishLinkedInTextPost(input: { accessToken: string; authorUrn: string; commentary: string }) {
  if (!/^urn:li:(person|organization):[^\s]+$/i.test(input.authorUrn)) {
    throw new Error("LinkedIn author URN is invalid.");
  }
  const response = await fetch(LINKEDIN_POSTS_URL, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + input.accessToken,
      "Content-Type": "application/json",
      "Linkedin-Version": process.env.LINKEDIN_API_VERSION || "202609",
      "X-Restli-Protocol-Version": "2.0.0"
    },
    body: JSON.stringify({
      author: input.authorUrn,
      commentary: input.commentary,
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: []
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false
    }),
    cache: "no-store"
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error("LinkedIn publish failed (" + response.status + "): " + body.slice(0, 350));
  }
  return {
    id: response.headers.get("x-restli-id") || "linkedin-post",
    status: response.status
  };
}
