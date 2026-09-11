import { NextResponse } from "next/server";
import { estimateRouteMiles } from "@/lib/routing";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const originCity = url.searchParams.get("originCity")?.trim() ?? "";
  const originState = url.searchParams.get("originState")?.trim() ?? "";
  const destinationCity = url.searchParams.get("destinationCity")?.trim() ?? "";
  const destinationState = url.searchParams.get("destinationState")?.trim() ?? "";

  if (!originCity || !originState || !destinationCity || !destinationState) {
    return NextResponse.json({ error: "Origin and destination city/state are required" }, { status: 400 });
  }

  const estimate = await estimateRouteMiles(originCity, originState, destinationCity, destinationState);
  if (!estimate) {
    return NextResponse.json({ error: "Unable to estimate route miles for those locations" }, { status: 422 });
  }

  return NextResponse.json(estimate);
}
