import { Prisma } from "@prisma/client";

// Expresión SQL de la fecha EFECTIVA de una compra — reusada por todo caller
// que arma su propio vigenciaSql fuera de aplicarRegla (liberarComprasReclamables
// y los route handlers que la invocan). Un solo lugar evita que esta expresión
// diverja entre callers — si difiere, liberarComprasReclamables podría liberar
// compras que aplicarRegla después no reclama, dejándolas sin distribuir.
export const FECHA_EFECTIVA_COMPRA_SQL = Prisma.sql`COALESCE(c."fechaManual", c.fecha)`;

export interface ReglaVigencia {
  modo: "historico" | "entre_fechas" | "desde_adelante" | "desde_atras";
  fechaDesde: Date | null;
  fechaHasta: Date | null;
  extremosInclusivos: boolean;
}

export type VigenciaCondicion =
  | { tipo: "historico" }
  | { tipo: "entre_fechas"; desde: Date; hasta: Date; inclusivo: boolean }
  | { tipo: "desde_adelante"; desde: Date; inclusivo: boolean }
  | { tipo: "desde_atras"; hasta: Date; inclusivo: boolean };

// Puro — sin acceso a SQL/DB, así que es 100% testeable. La conversión a SQL
// vive en vigenciaToSql(), abajo, deliberadamente separada.
export function resolverVigencia(regla: ReglaVigencia): VigenciaCondicion {
  switch (regla.modo) {
    case "historico":
      return { tipo: "historico" };
    case "entre_fechas":
      if (!regla.fechaDesde) throw new Error("modo 'entre_fechas' requiere fechaDesde");
      if (!regla.fechaHasta) throw new Error("modo 'entre_fechas' requiere fechaHasta");
      return { tipo: "entre_fechas", desde: regla.fechaDesde, hasta: regla.fechaHasta, inclusivo: regla.extremosInclusivos };
    case "desde_adelante":
      if (!regla.fechaDesde) throw new Error("modo 'desde_adelante' requiere fechaDesde");
      return { tipo: "desde_adelante", desde: regla.fechaDesde, inclusivo: regla.extremosInclusivos };
    case "desde_atras":
      if (!regla.fechaHasta) throw new Error("modo 'desde_atras' requiere fechaHasta");
      return { tipo: "desde_atras", hasta: regla.fechaHasta, inclusivo: regla.extremosInclusivos };
  }
}

// Puro — versión en memoria de vigenciaToSql, para decidir si UNA compra
// concreta cae en la ventana de una regla (lib/apertura/reevaluacion.ts).
// vigenciaToSql sigue siendo la fuente para el filtrado masivo en SQL; esta
// función replica la MISMA semántica de extremos para el caso puntual.
export function fechaEnVigencia(fecha: Date, regla: ReglaVigencia): boolean {
  const cond = resolverVigencia(regla);
  const t = fecha.getTime();
  switch (cond.tipo) {
    case "historico":
      return true;
    case "entre_fechas":
      return cond.inclusivo
        ? t >= cond.desde.getTime() && t <= cond.hasta.getTime()
        : t > cond.desde.getTime() && t < cond.hasta.getTime();
    case "desde_adelante":
      return cond.inclusivo ? t >= cond.desde.getTime() : t > cond.desde.getTime();
    case "desde_atras":
      return cond.inclusivo ? t <= cond.hasta.getTime() : t < cond.hasta.getTime();
  }
}

// Glue a Prisma.Sql — no testeado unitariamente (sin DB para verificar que el
// SQL generado es correcto de punta a punta), la lógica de negocio ya está
// cubierta por los tests de resolverVigencia(). fechaCol es la expresión SQL
// de la fecha EFECTIVA (COALESCE ya resuelto por el caller, ver motor.ts).
export function vigenciaToSql(cond: VigenciaCondicion, fechaCol: Prisma.Sql): Prisma.Sql {
  switch (cond.tipo) {
    case "historico":
      return Prisma.sql`TRUE`;
    case "entre_fechas":
      return cond.inclusivo
        ? Prisma.sql`${fechaCol} >= ${cond.desde} AND ${fechaCol} <= ${cond.hasta}`
        : Prisma.sql`${fechaCol} > ${cond.desde} AND ${fechaCol} < ${cond.hasta}`;
    case "desde_adelante":
      return cond.inclusivo ? Prisma.sql`${fechaCol} >= ${cond.desde}` : Prisma.sql`${fechaCol} > ${cond.desde}`;
    case "desde_atras":
      return cond.inclusivo ? Prisma.sql`${fechaCol} <= ${cond.hasta}` : Prisma.sql`${fechaCol} < ${cond.hasta}`;
  }
}
