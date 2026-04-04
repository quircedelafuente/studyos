import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import type { JWT } from "next-auth/jwt";

/**
 * Lee env en tiempo de petición (Vercel inyecta aquí). Evita depender del valor
 * que existiera solo en build con `process.env.AUTH_SECRET` estático.
 */
function env(name: string): string | undefined {
  const v = process.env[name];
  if (v === undefined || v === null) return undefined;
  const t = String(v).trim();
  return t.length > 0 ? t : undefined;
}

async function refreshGoogleAccessToken(token: JWT): Promise<JWT> {
  const clientId = env("AUTH_GOOGLE_ID") ?? env("GOOGLE_CLIENT_ID") ?? "";
  const clientSecret =
    env("AUTH_GOOGLE_SECRET") ?? env("GOOGLE_CLIENT_SECRET") ?? "";
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: token.refresh_token as string,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
  };
  if (!res.ok || !data.access_token || !data.expires_in) {
    return { ...token, error: "RefreshAccessTokenError" as const };
  }
  return {
    ...token,
    access_token: data.access_token,
    expires_at: Math.floor(Date.now() / 1000 + data.expires_in),
    refresh_token: data.refresh_token ?? token.refresh_token,
    error: undefined,
  };
}

const nextAuth = NextAuth(() => {
  const secret = env("AUTH_SECRET") ?? env("NEXTAUTH_SECRET");
  const clientId = env("AUTH_GOOGLE_ID") ?? env("GOOGLE_CLIENT_ID");
  const clientSecret =
    env("AUTH_GOOGLE_SECRET") ?? env("GOOGLE_CLIENT_SECRET");

  if (!secret) {
    console.error(
      "[auth] Falta AUTH_SECRET o NEXTAUTH_SECRET en el entorno del servidor (Vercel → Environment Variables → Production).",
    );
  }
  if (!clientId || !clientSecret) {
    console.error(
      "[auth] Faltan AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET (o GOOGLE_CLIENT_*) en el entorno del servidor.",
    );
  }

  return {
    trustHost: true,
    secret,
    providers: [
      Google({
        clientId: clientId ?? "",
        clientSecret: clientSecret ?? "",
        authorization: {
          params: {
            scope:
              "openid email profile https://www.googleapis.com/auth/calendar",
            prompt: "consent",
            access_type: "offline",
            response_type: "code",
          },
        },
      }),
    ],
    callbacks: {
      async jwt({ token, account }): Promise<JWT> {
        try {
          if (account?.access_token) {
            return {
              ...token,
              access_token: account.access_token,
              expires_at: account.expires_at,
              refresh_token: account.refresh_token,
            };
          }
          const expMs =
            typeof token.expires_at === "number"
              ? token.expires_at * 1000
              : 0;
          if (expMs && Date.now() < expMs - 60_000) {
            return token;
          }
          if (token.refresh_token) {
            return refreshGoogleAccessToken(token);
          }
          return token;
        } catch (e) {
          console.error("[auth] jwt callback error:", e);
          return token;
        }
      },
      async session({ session, token }) {
        return {
          ...session,
          user: {
            ...session.user,
            id: token.sub ?? "",
          },
          error: token.error as string | undefined,
        };
      },
    },
  };
});

export const handlers = nextAuth.handlers;
export const auth = nextAuth.auth;
