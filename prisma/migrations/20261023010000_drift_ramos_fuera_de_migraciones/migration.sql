-- Piezas que en la base de Ramos se crearon a mano, fuera de las migraciones
-- (detectado al levantar la instancia de Comercio, 22/10/2026). Todo es
-- idempotente: en Ramos no cambia nada; en una base nueva la deja completa.

-- 1) ventas."importeManual" (está en schema.prisma pero ninguna migración la creaba;
--    sin ella la fila Ingresos del panel da "column v.importeManual does not exist").
ALTER TABLE "ventas" ADD COLUMN IF NOT EXISTS "importeManual" DECIMAL(65,30);

-- 2) Config de Drive por usuario (carpeta + refresh token de Google). La usa
--    app/api/drive/* y app/auth/callback por PostgREST (service role), no Prisma.
--    Depende de auth.users de Supabase: al migrar a otra base, rehacer esta parte.
CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

CREATE TABLE IF NOT EXISTS public.user_drive_config (
  user_id uuid NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id text,
  folder_name text,
  refresh_token text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_drive_config ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_drive_config' AND policyname = 'user_drive_config_own'
  ) THEN
    CREATE POLICY user_drive_config_own ON public.user_drive_config
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE OR REPLACE TRIGGER trg_user_drive_config_updated_at
  BEFORE UPDATE ON public.user_drive_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
