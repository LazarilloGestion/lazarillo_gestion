import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { buildPivotConditions } from "@/lib/dashboard/query-builders";

export const dynamic = "force-dynamic";

const qSchema = z.string().trim().max(200);
const idSchema = z.coerce.number().int().positive().optional();

type OrigenRow = {
  conceptoCodigo: string | null;
  rubroCodigo: string | null;
  proveedorId: number | null;
};

// Rubros, conceptos y proveedores con al menos una compra en el local/PDV dado, de cualquier año.
// Mismas reglas que el pivot (fecha/importe efectivos, local/PDV destino de la vista distribuida),
// así toda sugerencia corresponde a algo que la tabla puede mostrar en ese origen.
async function origenesConCompras(localId: number | undefined, pdvId: number | undefined) {
  const where = Prisma.join(buildPivotConditions({ tableAlias: "c", localId, pdvId }), " AND ");
  const rows = await prisma.$queryRaw<OrigenRow[]>(Prisma.sql`
    SELECT DISTINCT
      COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") AS "conceptoCodigo",
      cc."codRga"                                            AS "rubroCodigo",
      c."proveedorId"                                        AS "proveedorId"
    FROM v_compras_distribuidas c
    LEFT JOIN conceptos_caja cc ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
    WHERE ${where}
  `);
  const sinNulos = <T,>(xs: (T | null)[]): T[] => xs.filter((x): x is T => x !== null);
  return {
    rubros: sinNulos(rows.map((r) => r.rubroCodigo)),
    conceptos: sinNulos(rows.map((r) => r.conceptoCodigo)),
    proveedores: sinNulos(rows.map((r) => r.proveedorId)),
  };
}

export type SuggestionPdv = {
  localId: number | null;
  puntoDeVentaId: number | null;
  localNombre: string | null;
  puntoDeVentaNombre: string | null;
};

export type Suggestion = {
  id: string;
  label: string;
  type: "rubro" | "concepto" | "proveedor";
  // payload que se mapea a URL param
  param: "rubroCodigo" | "conceptoCodigo" | "proveedorId";
  value: string;
  rubroNombre?: string; // solo para type === "concepto"
  rubroCodigo?: string; // solo para type === "concepto"
  // Con query: local/PDV donde la entidad tiene compras, de la compra más reciente a la más
  // vieja. El palette etiqueta las que no tienen nada en el PDV que se mira y, al elegirlas,
  // navega al primero de la lista. Ausente en el preview sin query.
  pdvs?: SuggestionPdv[];
};

type OrigenPorPdvRow = OrigenRow & SuggestionPdv & { ultima: Date | null };

// Igual que origenesConCompras pero SIN acotar a un local/PDV y agrupando por dónde está cada
// compra: alimenta la búsqueda con query, que recorre todos los PDV (Diego, 22/10/2026 — un
// proveedor que solo compró en otro PDV también tiene que aparecer, con su etiqueta).
async function origenesPorPdv() {
  const where = Prisma.join(buildPivotConditions({ tableAlias: "c" }), " AND ");
  const rows = await prisma.$queryRaw<OrigenPorPdvRow[]>(Prisma.sql`
    SELECT
      COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") AS "conceptoCodigo",
      cc."codRga"                                            AS "rubroCodigo",
      c."proveedorId"                                        AS "proveedorId",
      c."localId"                                            AS "localId",
      c."puntoDeVentaId"                                     AS "puntoDeVentaId",
      l.nombre                                               AS "localNombre",
      pv.nombre                                              AS "puntoDeVentaNombre",
      MAX(COALESCE(c."fechaManual", c.fecha))                AS ultima
    FROM v_compras_distribuidas c
    LEFT JOIN conceptos_caja cc  ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc.codigo
    LEFT JOIN locales l          ON c."localId" = l.id
    LEFT JOIN puntos_de_venta pv ON c."puntoDeVentaId" = pv.id
    WHERE ${where}
    GROUP BY 1, 2, 3, 4, 5, 6, 7
  `);
  const agrupar = <K,>(clave: (r: OrigenPorPdvRow) => K | null): Map<K, SuggestionPdv[]> => {
    const porClave = new Map<K, (SuggestionPdv & { ultima: number })[]>();
    for (const r of rows) {
      const k = clave(r);
      if (k === null) continue;
      const lista = porClave.get(k) ?? [];
      const ya = lista.find((x) => x.localId === r.localId && x.puntoDeVentaId === r.puntoDeVentaId);
      const t = r.ultima ? new Date(r.ultima).getTime() : 0;
      if (ya) ya.ultima = Math.max(ya.ultima, t);
      else lista.push({ localId: r.localId, puntoDeVentaId: r.puntoDeVentaId, localNombre: r.localNombre, puntoDeVentaNombre: r.puntoDeVentaNombre, ultima: t });
      porClave.set(k, lista);
    }
    const out = new Map<K, SuggestionPdv[]>();
    for (const [k, lista] of porClave) {
      out.set(
        k,
        [...lista]
          .sort((a, b) => b.ultima - a.ultima)
          .map((p) => ({ localId: p.localId, puntoDeVentaId: p.puntoDeVentaId, localNombre: p.localNombre, puntoDeVentaNombre: p.puntoDeVentaNombre }))
      );
    }
    return out;
  };
  return {
    rubros: agrupar((r) => r.rubroCodigo),
    conceptos: agrupar((r) => r.conceptoCodigo),
    proveedores: agrupar((r) => r.proveedorId),
  };
}

export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  // Sin query: preview alfabético acotado (pantalla "Buscar en" antes de tipear).
  // Con query: búsqueda real sobre toda la tabla vía ILIKE, no limitada por el preview.
  const { searchParams } = new URL(request.url);
  const q = qSchema.safeParse(searchParams.get("q")).data ?? "";
  const localId = idSchema.safeParse(searchParams.get("localId") ?? undefined).data;
  const pdvId = idSchema.safeParse(searchParams.get("pdvId") ?? undefined).data;
  const sanitizedQ = q.replace(/[%_\\]/g, "\\$&"); // escapa wildcards de ILIKE
  const textFilter = q.length > 0 ? { contains: sanitizedQ, mode: "insensitive" as const } : undefined;

  try {
    // Preview (sin query): acotado al local/PDV activo, como siempre. Con query: se busca en
    // TODOS los PDV y cada sugerencia dice dónde tiene compras (pdvs); solo se descartan las
    // entidades sin ninguna compra en ningún lado cuando hay un local/PDV activo.
    const hayOrigenActivo = localId !== undefined || pdvId !== undefined;
    const porPdv = textFilter && hayOrigenActivo ? await origenesPorPdv() : null;
    const origen = !textFilter && hayOrigenActivo ? await origenesConCompras(localId, pdvId) : null;
    const enAlguno = porPdv
      ? {
          rubros: [...porPdv.rubros.keys()],
          conceptos: [...porPdv.conceptos.keys()],
          proveedores: [...porPdv.proveedores.keys()],
        }
      : null;

    const [rubros, conceptos, proveedores] = await Promise.all([
      prisma.rubroConceptoCaja.findMany({
        select: { codigo: true, nombre: true },
        where: {
          ...(textFilter ? { nombre: textFilter } : {}),
          ...(origen ? { codigo: { in: origen.rubros } } : enAlguno ? { codigo: { in: enAlguno.rubros } } : {}),
        },
        orderBy: { nombre: "asc" },
        take: textFilter ? 50 : 500,
      }),
      prisma.conceptoCaja.findMany({
        select: { codigo: true, nombre: true, rubro: { select: { codigo: true, nombre: true } } },
        where: {
          ...(textFilter ? { nombre: textFilter } : {}),
          ...(origen ? { codigo: { in: origen.conceptos } } : enAlguno ? { codigo: { in: enAlguno.conceptos } } : {}),
        },
        orderBy: { nombre: "asc" },
        take: textFilter ? 50 : 500,
      }),
      prisma.proveedor.findMany({
        select: { id: true, nombre: true, razon: true },
        where: {
          ...(textFilter ? { OR: [{ nombre: textFilter }, { razon: textFilter }] } : {}),
          ...(origen ? { id: { in: origen.proveedores } } : enAlguno ? { id: { in: enAlguno.proveedores } } : {}),
        },
        orderBy: [{ nombre: "asc" }],
        take: textFilter ? 50 : 200,
      }),
    ]);

    const suggestions: Suggestion[] = [
      ...rubros.map((r) => ({
        id: `rubro:${r.codigo}`,
        label: r.nombre ?? r.codigo,
        type: "rubro" as const,
        param: "rubroCodigo" as const,
        value: r.codigo,
        ...(porPdv ? { pdvs: porPdv.rubros.get(r.codigo) ?? [] } : {}),
      })),
      ...conceptos.map((c) => ({
        id: `concepto:${c.codigo}`,
        label: c.nombre ?? c.codigo,
        type: "concepto" as const,
        param: "conceptoCodigo" as const,
        value: c.codigo,
        rubroNombre: c.rubro?.nombre ?? undefined,
        rubroCodigo: c.rubro?.codigo ?? undefined,
        ...(porPdv ? { pdvs: porPdv.conceptos.get(c.codigo) ?? [] } : {}),
      })),
      ...proveedores.map((p) => ({
        id: `proveedor:${p.id}`,
        label: p.nombre ?? p.razon ?? `Proveedor ${p.id}`,
        type: "proveedor" as const,
        param: "proveedorId" as const,
        value: String(p.id),
        ...(porPdv ? { pdvs: porPdv.proveedores.get(p.id) ?? [] } : {}),
      })),
    ];

    return NextResponse.json(suggestions);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
