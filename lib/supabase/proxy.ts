import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const publicPrefixes = [
  "/login",
  "/auth/",
  "/unauthorized",
  "/sw.js",
  "/manifest.webmanifest",
  "/carrier/onboard/",
  "/carrier/offers/",
  "/carrier/dispatch/",
  "/driver/loads/",
  "/api/public/",
  "/api/internal/",
  "/api/webhooks/resend",
  "/api/health",
  "/api/routing/estimate",
  "/api/offers/"
];

function isPublicPath(pathname: string) {
  if (pathname === "/") return true;
  return publicPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

export async function updateSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    if (isPublicPath(request.nextUrl.pathname)) return NextResponse.next({ request });
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.searchParams.set("error", "auth_not_configured");
    return NextResponse.redirect(login);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([header, value]) => response.headers.set(header, value));
      }
    }
  });

  const { data } = await supabase.auth.getClaims();
  const authenticated = Boolean(data?.claims?.sub);
  const pathname = request.nextUrl.pathname;

  if (!authenticated && !isPublicPath(pathname)) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }

  return response;
}
