import crypto from "crypto";
import { APP_GATE_COOKIE_NAME } from "@/lib/app-gate-shared";

function envOrEmpty(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function appGateSecret(): string {
  return envOrEmpty("APP_GATE_SECRET");
}

export function normalizePathWithQuery(url: URL): string {
  // Firma estable: pathname + search (sin origin)
  return `${url.pathname}${url.search}`;
}

export function timingSafeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function hmacForAppGate(args: {
  secret: string;
  appId: string;
  ts: string;
  pathWithQuery: string;
}): string {
  const msg = `${args.appId}.${args.ts}.${args.pathWithQuery}`;
  const mac = crypto.createHmac("sha256", args.secret).update(msg).digest();
  return b64url(mac);
}

export function verifyAppGateHeaders(args: {
  secret: string;
  appId: string | null;
  ts: string | null;
  sig: string | null;
  pathWithQuery: string;
  nowMs?: number;
  maxSkewSec?: number;
}): { ok: true } | { ok: false; reason: string } {
  const { secret } = args;
  const appId = (args.appId ?? "").trim();
  const ts = (args.ts ?? "").trim();
  const sig = (args.sig ?? "").trim();
  const nowMs = args.nowMs ?? Date.now();
  const maxSkewSec = args.maxSkewSec ?? 60;

  if (!secret) return { ok: false, reason: "missing_secret" };
  if (!appId || !ts || !sig) return { ok: false, reason: "missing_headers" };
  if (!/^\d{10}$/.test(ts)) return { ok: false, reason: "bad_ts" };

  const tsMs = Number(ts) * 1000;
  if (!Number.isFinite(tsMs)) return { ok: false, reason: "bad_ts" };
  if (Math.abs(nowMs - tsMs) > maxSkewSec * 1000) return { ok: false, reason: "skew" };

  const expected = hmacForAppGate({
    secret,
    appId,
    ts,
    pathWithQuery: args.pathWithQuery,
  });
  if (!timingSafeEq(expected, sig)) return { ok: false, reason: "bad_sig" };
  return { ok: true };
}

