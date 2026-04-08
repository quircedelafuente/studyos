import { NextResponse, type NextRequest } from "next/server";
import { APP_GATE_COOKIE_NAME } from "@/lib/app-gate-shared";

function isPublicPath(pathname: string): boolean {
  // Assets / Next internals
  if (pathname.startsWith("/_next/")) return true;
  if (pathname === "/favicon.ico") return true;
  if (pathname === "/robots.txt") return true;
  if (pathname === "/sitemap.xml") return true;

  // Auth endpoints must remain reachable
  if (pathname.startsWith("/api/auth/")) return true;
  // App gate exchange must remain reachable
  if (pathname === "/api/app-gate/exchange") return true;
  // Gate login/logout + UI
  if (pathname === "/api/app-gate/login") return true;
  if (pathname === "/api/app-gate/logout") return true;
  if (pathname === "/gate") return true;

  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  // 1) Allow if app gate cookie present (mobile app after exchange)
  const gateCookie = req.cookies.get(APP_GATE_COOKIE_NAME)?.value;
  if (gateCookie === "1") return NextResponse.next();

  // Block everything else
  return NextResponse.json(
    { error: "forbidden", detail: "App Gate: acceso restringido." },
    { status: 403 },
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};

