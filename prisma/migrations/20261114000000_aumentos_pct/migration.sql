-- Aumentos de precios (Diego 30/10/2026): el % que subió la carta (detectado del informe 12), si es
-- provisorio (menos de 3 semanas después del aumento) y si Diego lo descartó (no se vuelve a detectar).
ALTER TABLE "aumentos_precio" ADD COLUMN IF NOT EXISTS "pct" NUMERIC(7,4);
ALTER TABLE "aumentos_precio" ADD COLUMN IF NOT EXISTS "provisorio" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "aumentos_precio" ADD COLUMN IF NOT EXISTS "descartado" BOOLEAN NOT NULL DEFAULT false;

-- Bar de Ramos: % medidos el 30/10/2026 (precio 2 semanas antes vs semanas 2 y 3 después).
UPDATE "aumentos_precio" a SET pct = v.pct, provisorio = v.prov
FROM (VALUES ('2026-06-15'::date, 0.039, false), ('2026-08-24'::date, 0.045, false), ('2026-10-19'::date, 0.075, true)) AS v(f, pct, prov),
     "puntos_de_venta" p JOIN "locales" l ON l.id = p."localId"
WHERE a."puntoDeVentaId" = p.id AND a.fecha = v.f AND a.origen = 'detectado'
  AND TRIM(p.nombre) ILIKE 'bar' AND TRIM(l.nombre) ILIKE 'ramos%';
