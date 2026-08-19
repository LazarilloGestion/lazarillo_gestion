import { Prisma } from "@prisma/client";

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
