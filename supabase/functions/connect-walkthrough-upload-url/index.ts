import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "connect-walkthrough";
const OBJECT_PATH = "arborline-connect-walkthrough.mp4";
const MAX_BYTES = 50 * 1024 * 1024;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function getSecretKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const bag = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!bag) return legacy;
  try {
    const parsed = JSON.parse(bag) as Record<string, string>;
    return parsed.default ?? Object.values(parsed)[0] ?? legacy;
  } catch {
    return legacy;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKey = getSecretKey();
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!supabaseUrl || !secretKey) return json({ error: "Server storage credentials are unavailable" }, 500);
  if (!token) return json({ error: "Authentication required" }, 401);

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return json({ error: "Authentication required" }, 401);

  const { data: appUser, error: roleError } = await admin
    .from("app_users")
    .select("role,is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (roleError) return json({ error: "Unable to verify staff access" }, 500);
  if (!appUser?.is_active || appUser.role !== "STAFF") return json({ error: "Forbidden" }, 403);

  let body: { size?: number; contentType?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }

  const size = Number(body.size ?? 0);
  const contentType = String(body.contentType ?? "").toLowerCase();
  if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) return json({ error: "Video must be 50 MB or smaller" }, 400);
  if (contentType && contentType !== "video/mp4") return json({ error: "Video must be an MP4" }, 400);

  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUploadUrl(OBJECT_PATH, { upsert: true });

  if (error || !data?.token) {
    console.error("Failed to create walkthrough signed upload URL", error);
    return json({ error: "Unable to prepare walkthrough upload" }, 500);
  }

  return json({ token: data.token, path: OBJECT_PATH });
});
