-- Aumentos por agrupación de la carta (Diego 30/10/2026: "generalmente subo todo junto pero puede pasar
-- que alguna vez suba solo alguna agrupación"): cuánto subió cada una (comidas / bebidas / promos).
ALTER TABLE "aumentos_precio" ADD COLUMN IF NOT EXISTS "detalle" JSONB;

-- Bar de Ramos: los 6 aumentos medidos el 30/10/2026 con la detección por agrupación (informe 12).
WITH bar AS (
  SELECT p.id FROM "puntos_de_venta" p JOIN "locales" l ON l.id = p."localId"
  WHERE TRIM(p.nombre) ILIKE 'bar' AND TRIM(l.nombre) ILIKE 'ramos%'
), v(f, pct, det, prov) AS (VALUES
  ('2025-09-29'::date, 0.0421, '{"comidas":0.0371,"bebidas":0.0381,"promos":0.0594}'::jsonb, false),
  ('2025-12-01'::date, 0.0401, '{"comidas":0.0298,"bebidas":0.0454,"promos":0.0612}'::jsonb, false),
  ('2026-03-30'::date, 0.0165, '{"comidas":0.0094,"bebidas":0.0548,"promos":-0.0100}'::jsonb, false),
  ('2026-06-15'::date, 0.0391, '{"comidas":0.0320,"bebidas":0.0514,"promos":0.0433}'::jsonb, false),
  ('2026-08-24'::date, 0.0452, '{"comidas":0.0512,"bebidas":0.0328,"promos":0.0461}'::jsonb, false),
  ('2026-10-19'::date, 0.0747, '{"comidas":0.0778,"bebidas":0.0902,"promos":0.0599}'::jsonb, true)
)
INSERT INTO "aumentos_precio" ("puntoDeVentaId", "fecha", "origen", "pct", "detalle", "provisorio")
SELECT bar.id, v.f, 'detectado', v.pct, v.det, v.prov FROM bar, v
ON CONFLICT ("puntoDeVentaId", "fecha") DO UPDATE
  SET pct = EXCLUDED.pct, detalle = EXCLUDED.detalle, provisorio = EXCLUDED.provisorio
  WHERE "aumentos_precio".origen = 'detectado' AND NOT "aumentos_precio".descartado;
