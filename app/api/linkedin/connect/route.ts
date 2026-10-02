import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { createLinkedInAuthorizationUrl, linkedinOAuthConfig } from "@/lib/linkedin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireApiRole(["STAFF"]);
  if (!auth.identity) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const config = linkedinOAuthConfig(request.nextUrl.origin);
    const state = randomBytes(24).toString("hex");
    const response = NextResponse.redirect(createLinkedInAuthorizationUrl(config, state));
    response.cookies.set("arborline_linkedin_oauth_state", state, {
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: 600
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "LinkedIn OAuth is not configured.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
