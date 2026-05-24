-- Configuración de Drive por usuario
-- Ejecutar en Supabase SQL Editor (Dashboard → SQL Editor → New Query)

-- SECURITY NOTE: refresh_token almacenado en texto plano.
-- Aceptable para app interna (1-2 usuarios); migrar a Supabase Vault si escala.
CREATE TABLE IF NOT EXISTS user_drive_config (
  user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id     TEXT,
  folder_name   TEXT,
  refresh_token TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Solo el propio usuario puede leer/escribir su config
ALTER TABLE user_drive_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_drive_config_own"
  ON user_drive_config
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
