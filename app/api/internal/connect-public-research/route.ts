import { NextResponse } from "next/server";
import { researchQualifiedProspects } from "@/lib/connect-public-research";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "private, no-cache, no-store, max-age=0, must-revalidate",
      "referrer-policy": "no-referrer"
    }
  });
}

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return response({ error: "CRON_SECRET is not configured." }, 503);
  if (request.headers.get("authorization") !== `Bearer ${expected}`) return response({ error: "Unauthorized." }, 401);

  const url = new URL(request.url);
  const clientId = url.searchParams.get("client")?.trim() ?? "";
  const segmentId = url.searchParams.get("segment")?.trim() ?? "";
  const requestedLimit = Number(url.searchParams.get("limit") ?? 10);

  if (!UUID.test(clientId)) return response({ error: "A valid client id is required." }, 400);
  if (segmentId && !UUID.test(segmentId)) return response({ error: "Invalid segment id." }, 400);
  if (!Number.isFinite(requestedLimit) || requestedLimit < 1 || requestedLimit > 20) {
    return response({ error: "Research limit must be between 1 and 20." }, 400);
  }

  try {
    const result = await researchQualifiedProspects(
      clientId,
      Math.floor(requestedLimit),
      segmentId || null
    );
    return response({ ok: true, result, ranAt: new Date().toISOString() });
  } catch (error) {
    return response({
      error: error instanceof Error ? error.message.slice(0, 500) : "ArborLine Research failed.",
      ranAt: new Date().toISOString()
    }, 500);
  }
}
