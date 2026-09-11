import { NextResponse } from "next/server";
import { rankCandidates } from "@/lib/matching";
import type { CarrierCandidate, LoadForMatching } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { load?: LoadForMatching; candidates?: CarrierCandidate[] };
    if (!body.load || !Array.isArray(body.candidates)) {
      return NextResponse.json({ error: "load and candidates are required" }, { status: 400 });
    }
    return NextResponse.json({ matches: rankCandidates(body.load, body.candidates) });
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }
}
