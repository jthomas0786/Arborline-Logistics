import { NextResponse } from "next/server";
import { runAutopilot } from "@/lib/workflow";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ autopilot: await runAutopilot(id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to run autopilot";
    return NextResponse.json({ error: message }, { status: message === "Load not found" ? 404 : 500 });
  }
}
