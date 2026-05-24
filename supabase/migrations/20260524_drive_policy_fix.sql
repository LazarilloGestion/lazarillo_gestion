-- Fix: DROP POLICY IF EXISTS antes de recrear para que la migración sea idempotente
DROP POLICY IF EXISTS "user_drive_config_own" ON user_drive_config;

CREATE POLICY "user_drive_config_own"
  ON user_drive_config
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Fix: trigger para actualizar updated_at en cada UPDATE
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_drive_config_updated_at ON user_drive_config;
CREATE TRIGGER trg_user_drive_config_updated_at
  BEFORE UPDATE ON user_drive_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
