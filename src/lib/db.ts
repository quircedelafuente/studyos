import { neon } from "@neondatabase/serverless";

export function getSql() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;
  return neon(url);
}
