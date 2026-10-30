-- Punto de equilibrio (Diego 30/10/2026): qué gastos son VARIABLES (acompañan a la venta).
-- Por rubro o por concepto (el concepto manda sobre su rubro), con un % (100 = todo variable;
-- ej. personal 20%). Lo que no figura acá es fijo.
-- Default de Diego: Mercaderías, Otros gastos, Impuesto fiscal y los Feriados del personal.
CREATE TABLE IF NOT EXISTS "equilibrio_variables" (
  "tipo"    TEXT NOT NULL CHECK ("tipo" IN ('rubro', 'concepto')),
  "codigo"  TEXT NOT NULL,
  "pct"     NUMERIC(5,2) NOT NULL CHECK ("pct" >= 0 AND "pct" <= 100),
  "creadoEn" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "equilibrio_variables_pkey" PRIMARY KEY ("tipo", "codigo")
);

INSERT INTO "equilibrio_variables" ("tipo", "codigo", "pct")
SELECT 'rubro', codigo, 100 FROM "rubros_concepto_caja"
WHERE TRIM(nombre) ILIKE 'mercader%' OR TRIM(nombre) ILIKE 'otros gastos' OR TRIM(nombre) ILIKE 'impuesto fiscal'
ON CONFLICT DO NOTHING;

INSERT INTO "equilibrio_variables" ("tipo", "codigo", "pct")
SELECT 'concepto', codigo, 100 FROM "conceptos_caja" WHERE TRIM(nombre) ILIKE 'feriados'
ON CONFLICT DO NOTHING;
