import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/privacy", "/terms", "/api/cron", "/api/health", "/_next", "/favicon", "/logo-mark", "/brand"];

/**
 * Content-Security-Policy with a fresh nonce per request: only scripts carrying the nonce (Next adds it to its own
 * scripts when it finds it in the request's CSP header) and scripts they load ('strict-dynamic') may run — an injected
 * <script> or inline handler is blocked even if an XSS sink ever appears. Styles stay 'unsafe-inline' (next/font, print CSS).
 */
function contentSecurityPolicy(nonce: string) {
  const dev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // Gemini and every messaging vendor are called server-side only; the browser talks to this origin only.
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    // 'self': the document page previews private PDFs from /api/files in a same-origin <iframe>.
    "frame-src 'self'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    dev ? "" : "upgrade-insecure-requests",
  ]
    .filter(Boolean)
    .join("; ");
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce);

  const isPublic = pathname === "/" || pathname.startsWith("/request") || PUBLIC.some((p) => pathname.startsWith(p));
  if (!isPublic && !req.cookies.get("darak_session")?.value) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Request headers the app reads: the nonce (Next applies it to its scripts) and the path (route guard in requireStaff).
  // Both are always overwritten here, so a client can never supply its own.
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  headers.set("x-pathname", pathname);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: [
    // Every page, RSC and API request — prefetches included: the route guard in requireStaff relies on x-pathname set here.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.svg$|.*\\.png$|.*\\.ico$).*)",
  ],
};
