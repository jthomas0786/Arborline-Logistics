import { NextResponse } from "next/server";
import { getWebPushConfig } from "@/lib/web-push";

export async function GET() {
  try {
    const config = await getWebPushConfig();
    return NextResponse.json({ enabled: true, publicKey: config.publicKey });
  } catch (error) {
    return NextResponse.json({ enabled: false, publicKey: null, error: error instanceof Error ? error.message : "Web Push is unavailable." }, { status: 503 });
  }
}
