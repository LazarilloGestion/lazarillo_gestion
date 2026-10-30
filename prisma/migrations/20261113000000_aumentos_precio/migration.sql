-- Aumentos de precios de la carta por PDV (Diego 30/10/2026): la Canasta mide cuánto subieron los
-- costos DESDE el último aumento. Por ahora se cargan/corrigen a mano desde la tarjeta Canasta; más
-- adelante se detectan solos del informe 12 (salto general del precio unitario de los más vendidos).
CREATE TABLE IF NOT EXISTS "aumentos_precio" (
  "puntoDeVentaId" INTEGER NOT NULL REFERENCES "puntos_de_venta"("id") ON DELETE CASCADE,
  "fecha"          DATE    NOT NULL,
  "origen"         TEXT    NOT NULL DEFAULT 'manual' CHECK ("origen" IN ('manual', 'detectado')),
  "creadoEn"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "aumentos_precio_pkey" PRIMARY KEY ("puntoDeVentaId", "fecha")
);

-- Bar de Ramos: semanas de aumento detectadas en el informe 12 y confirmadas por Diego (30/10/2026).
INSERT INTO "aumentos_precio" ("puntoDeVentaId", "fecha", "origen")
SELECT p.id, f::date, 'detectado'
FROM "puntos_de_venta" p
JOIN "locales" l ON l.id = p."localId"
CROSS JOIN (VALUES ('2026-06-15'), ('2026-08-24'), ('2026-10-19')) AS v(f)
WHERE TRIM(p.nombre) ILIKE 'bar' AND TRIM(l.nombre) ILIKE 'ramos%'
ON CONFLICT DO NOTHING;
