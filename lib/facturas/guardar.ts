import { Prisma, type PrismaClient } from "@prisma/client";
import { armarFactura, facturaSchema, CONCEPTO_PERCEPCION, ORIGEN_LAZARILLO, type FacturaInput } from "./armar";

// Alta / edición / baja de una factura cargada en Lazarillo (Etapa 4). Las filas
// van a compras y detalle_compras igual que las de MaxiRest (origen 'lazarillo'),
// lo cargado tal cual a facturas_lazarillo (para verla y editarla) y cada acción
// a la actividad del usuario.

type Tx = Prisma.TransactionClient;
export type Armada = ReturnType<typeof armarFactura>;
export type Preparada = { f: FacturaInput; armado: Armada; proveedorCodigo: string; nombreProv: string };

export async function prepararFactura(prisma: PrismaClient, body: unknown): Promise<Preparada | { error: string; detalle?: string[]; status: number }> {
  const parsed = facturaSchema.safeParse(body);
  if (!parsed.success) return { error: "Datos inválidos", detalle: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`), status: 400 };
  const f = parsed.data;
  const proveedor = await prisma.proveedor.findUnique({ where: { id: f.proveedorId }, select: { id: true, codigo: true, nombre: true, razon: true } });
  if (!proveedor) return { error: "Proveedor inexistente", status: 400 };
  const pdvs = await prisma.puntoDeVenta.findMany({ select: { id: true, localId: true } });
  const usados = new Set<number>(f.registros.flatMap((r) => [r.puntoDeVentaId, ...(r.reparto ?? []).map((x) => x.puntoDeVentaId)]));
  if ([...usados].some((id) => !pdvs.some((p) => p.id === id))) return { error: "PDV inexistente", status: 400 };
  const codigos = [...new Set([...f.registros.map((r) => r.conceptoCodigo), ...f.percepciones.map((p) => CONCEPTO_PERCEPCION[p.tipo])])];
  const conceptos = await prisma.conceptoCaja.findMany({ where: { codigo: { in: codigos } }, select: { codigo: true, nombre: true } });
  const faltan = codigos.filter((c) => !conceptos.some((x) => x.codigo === c));
  if (faltan.length) return { error: `Concepto de caja inexistente: ${faltan.join(", ")}`, status: 400 };
  let armado: Armada;
  try {
    armado = armarFactura(f, { proveedor, pdvs, conceptos });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo armar la factura", status: 400 };
  }
  if (!armado.filas.length) return { error: "La factura no tiene importe", status: 400 };
  return { f, armado, proveedorCodigo: proveedor.codigo, nombreProv: proveedor.nombre ?? proveedor.razon ?? proveedor.codigo };
}

export async function insertarArmado(tx: Tx, p: Preparada) {
  const { armado, nombreProv } = p;
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO compras (
      "rowId", comprobante, "codCga", concepto, fecha, codigo, proveedor, detalle, observac,
      importe, "importeTrabajado", "impInt", per1, per2, per3,
      "proveedorId", "conceptoCodigo", "localId", "puntoDeVentaId", "esBloqueado", origen
    ) VALUES ${Prisma.join(armado.filas.map((x) => Prisma.sql`(
      ${x.rowId}, ${x.comprobante}, ${x.codCga}, ${x.concepto}, ${x.fecha}::date, ${x.codigo}, ${nombreProv}, ${x.detalle}, ${x.observac},
      ${x.importe}::numeric, ${x.importe}::numeric, ${x.impInt}::numeric, ${x.per1}::numeric, ${x.per2}::numeric, ${x.per3}::numeric,
      ${x.proveedorId}::int, ${x.conceptoCodigo}, ${x.localId}::int, ${x.puntoDeVentaId}::int, ${x.esBloqueado}, ${ORIGEN_LAZARILLO}
    )`))}
  `);
  if (armado.lineas.length) {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO detalle_compras (
        "rowId", "codPro", "codCpb", numero1, numero2, comprobante, fecha, codigo, nombre, medida,
        cantidad, neto, "totalIns", "ivaTot", "impNtTot", tasa, "codCga", "nomCga", "compraId", "proveedorId", "localId", origen
      ) VALUES ${Prisma.join(armado.lineas.map((l) => Prisma.sql`(
        ${l.rowId}, ${l.codPro}, ${l.codCpb}, ${l.numero1}, ${l.numero2}, ${l.comprobante}, ${l.fecha}::date, ${l.codigo}, ${l.nombre}, ${l.medida},
        ${l.cantidad}::numeric, ${l.neto}::numeric, ${l.totalIns}::numeric, ${l.ivaTot}::numeric, ${l.impNtTot}::numeric, ${l.tasa}::numeric,
        ${l.codCga}, ${l.nomCga}, ${l.compraId}, ${l.proveedorId}::int, ${l.localId}::int, ${ORIGEN_LAZARILLO}
      )`))}
    `);
  }
}

// Locales donde quedó la factura (puede repartirse entre PDV de distintos locales).
export const localesDe = (armado: Armada) => [...new Set(armado.filas.map((x) => x.localId))];

// ¿Ya existe ese comprobante del proveedor en esos locales? (de MaxiRest o de
// Lazarillo). `excepto` = la misma factura que se está editando.
export async function yaExiste(
  tx: Tx | PrismaClient,
  locales: number[],
  comprobante: string,
  codigo: string,
  excepto?: { comprobante: string; codigo: string; locales: number[] },
): Promise<boolean> {
  const r = await tx.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM compras
    WHERE "localId" = ANY(${locales}::int[]) AND comprobante = ${comprobante} AND codigo = ${codigo}
      AND NOT (${!!excepto} AND origen = ${ORIGEN_LAZARILLO} AND comprobante = ${excepto?.comprobante ?? ""}
               AND codigo = ${excepto?.codigo ?? ""} AND "localId" = ANY(${excepto?.locales ?? []}::int[]))
  `;
  return (r[0]?.n ?? 0) > 0;
}

// Borra una factura de Lazarillo (sus filas del 14 —con sus distribuciones de
// apertura, en cascada— y sus líneas del 25). Nunca toca filas de MaxiRest.
export async function borrarFilas(tx: Tx, comprobante: string, codigo: string, locales: number[]) {
  await tx.$executeRaw`
    DELETE FROM detalle_compras
    WHERE origen = ${ORIGEN_LAZARILLO} AND comprobante = ${comprobante} AND "codPro" = ${codigo} AND "localId" = ANY(${locales}::int[])
  `;
  await tx.$executeRaw`
    DELETE FROM compras
    WHERE origen = ${ORIGEN_LAZARILLO} AND comprobante = ${comprobante} AND codigo = ${codigo} AND "localId" = ANY(${locales}::int[])
  `;
  await tx.facturaLazarillo.deleteMany({ where: { comprobante, codigo, localId: { in: locales } } });
}

export async function guardarCarga(tx: Tx, p: Preparada, usuario: string | null) {
  const a = p.armado;
  await tx.facturaLazarillo.create({
    data: {
      localId: a.filas[0].localId, comprobante: a.filas[0].comprobante, codigo: p.proveedorCodigo, proveedorId: p.f.proveedorId,
      fecha: new Date(`${p.f.fecha}T00:00:00Z`), total: a.total, payload: p.f as unknown as Prisma.InputJsonValue,
      creadoPor: usuario, actualizadoPor: usuario,
    },
  });
}

// Texto de la actividad: primera línea el proveedor, segunda comprobante · PDV · total
// (la campanita muestra "Factura cargada · <proveedor>" y abajo el resto).
export function descripcionFactura(p: Pick<Preparada, "f" | "nombreProv"> & { total: number; pdv?: string | null }) {
  const tipo = p.f.tipo === "Ticket" ? "Tic" : p.f.tipo;
  const comp = `${tipo} ${p.f.prefijo.padStart(4, "0")}-${p.f.numero.padStart(8, "0")}`;
  const total = `$ ${p.total.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${p.nombreProv}\n${[comp, p.pdv, total].filter(Boolean).join(" · ")}`;
}

export async function nombrePdv(tx: Tx | PrismaClient, id: number | null | undefined): Promise<string | null> {
  if (id == null) return null;
  const p = await tx.puntoDeVenta.findUnique({ where: { id }, select: { nombre: true, local: { select: { nombre: true } } } });
  return p ? `${p.local?.nombre ? `${p.local.nombre} · ` : ""}${p.nombre}` : null;
}

export async function registrarActividad(
  tx: Tx | PrismaClient,
  a: { tipo: string; accion: "creada" | "editada" | "eliminada" | "restaurada"; descripcion: string; refId?: string | null; localId?: number | null; usuario: string | null; datos?: unknown },
) {
  await tx.actividad.create({
    data: { tipo: a.tipo, accion: a.accion, descripcion: a.descripcion, refId: a.refId ?? null, localId: a.localId ?? null, usuario: a.usuario, datos: (a.datos ?? undefined) as Prisma.InputJsonValue | undefined },
  });
}
