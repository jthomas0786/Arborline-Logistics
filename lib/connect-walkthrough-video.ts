export const CONNECT_WALKTHROUGH_BUCKET = "connect-walkthrough";
export const CONNECT_WALKTHROUGH_OBJECT = "arborline-connect-walkthrough.mp4";

export function getConnectWalkthroughVideoUrl() {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!base) return null;
  return `${base}/storage/v1/object/public/${CONNECT_WALKTHROUGH_BUCKET}/${CONNECT_WALKTHROUGH_OBJECT}`;
}

export async function connectWalkthroughVideoAvailable() {
  const url = getConnectWalkthroughVideoUrl();
  if (!url) return false;
  try {
    const response = await fetch(url, { method: "HEAD", cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}
