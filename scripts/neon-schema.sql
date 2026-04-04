-- Ejecutar una vez en Neon (SQL Editor) o con psql contra DATABASE_URL.
CREATE TABLE IF NOT EXISTS user_app_kv (
  user_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_app_kv_updated_at_idx ON user_app_kv (updated_at DESC);
