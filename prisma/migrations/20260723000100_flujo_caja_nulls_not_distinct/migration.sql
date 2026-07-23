-- localId/puntoDeVentaId son nullable (carga a nivel local-sin-PDV o, en teoría, sin local).
-- Postgres trata NULL como distinto de NULL en un índice único común, lo que permitiría
-- filas duplicadas para el mismo (localId, NULL, anio, mes) vía upsert repetido.
-- NULLS NOT DISTINCT (Postgres 15+) hace que el índice trate esos NULLs como iguales entre sí.
DROP INDEX "flujo_caja_manual_localId_puntoDeVentaId_anio_mes_key";

CREATE UNIQUE INDEX "flujo_caja_manual_localId_puntoDeVentaId_anio_mes_key"
  ON "flujo_caja_manual" ("localId", "puntoDeVentaId", "anio", "mes")
  NULLS NOT DISTINCT;
