-- Repara drift preexistente: schema.prisma declara la relación
-- conceptoCajaManual (conceptoCodigoManual -> conceptos_caja.codigo) desde
-- hace tiempo, pero nunca se creó como constraint real (ni en el historial
-- de migraciones ni en la base). Verificado antes de aplicar: 0 filas de
-- compras usan conceptoCodigoManual hoy, sin huérfanos posibles. Mismas
-- acciones referenciales que la FK análoga ya existente (conceptoCodigo).
ALTER TABLE "compras" ADD CONSTRAINT "compras_conceptoCodigoManual_fkey"
  FOREIGN KEY ("conceptoCodigoManual") REFERENCES "conceptos_caja"("codigo")
  ON DELETE SET NULL ON UPDATE CASCADE;
