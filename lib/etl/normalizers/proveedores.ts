import { Prisma } from "@prisma/client";
import type { DbClient } from "../types";
import { trim } from "../helpers";
import type { ETLRow, ETLRowError } from "../types";
import { proveedorRowSchema, type ProveedorRow } from "../schemas/proveedores";
import { formatZodError } from "../schemas/common";

const CHUNK_SIZE = 500;

export async function normalizeProveedores(
  rows: ETLRow[],
  prisma: DbClient
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  const errors: ETLRowError[] = [];
  let skipped = 0;

  // Dedup por CODIGO (last-wins) es intencional para maestros: una fila con el
  // mismo código en el mismo export es la misma entidad real, no una colisión
  // de hash entre dos entidades distintas (a diferencia de compras/ventas).
  const parsedByCodigo = new Map<string, ProveedorRow>();

  rows.forEach((r, idx) => {
    if (trim(r["CODIGO"]) == null) {
      skipped++;
      return;
    }
    const parsed = proveedorRowSchema.safeParse(r);
    if (!parsed.success) {
      errors.push({ rowIndex: idx, rawCodigo: r["CODIGO"], message: formatZodError(parsed.error) });
      return;
    }
    parsedByCodigo.set(parsed.data.CODIGO, parsed.data);
  });

  const deduped = Array.from(parsedByCodigo.values());

  const allCodigos = deduped.map((d) => d.CODIGO);
  const existingSet = new Set(
    (await prisma.proveedor.findMany({ where: { codigo: { in: allCodigos } }, select: { codigo: true } }))
      .map((x) => x.codigo)
  );

  let created = 0, updated = 0;

  for (let i = 0; i < deduped.length; i += CHUNK_SIZE) {
    const chunk = deduped.slice(i, i + CHUNK_SIZE);
    try {
      const values = chunk.map((data) => {
        return Prisma.sql`(
          ${data.CODIGO},
          ${data.NOMBRE},
          ${data.RAZON},
          ${data.DIRECCION},
          ${data.LOCALIDAD},
          ${data.CONTACTO},
          ${data.TELEFONO},
          ${data.FAX},
          ${data.CELULAR},
          ${data.TIPO_IVA},
          ${data.CUIT},
          ${data.CBU},
          ${data.ALIASCBU},
          ${data.DIAS_VENC},
          ${data.IVA != null ? (data.IVA ? 1 : 0) : null},
          ${data.IVA_DIF != null ? (data.IVA_DIF ? 1 : 0) : null},
          ${data.E_MAIL},
          ${data.OBSERVAC},
          ${data.DETPERC}
        )`;
      });

      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO proveedores (
          codigo, nombre, razon, direccion, localidad, contacto,
          telefono, fax, celular, "tipoIva", cuit, cbu, "aliasCbu",
          "diasVenc", iva, "ivaDif", email, observac, "detPerc"
        )
        VALUES ${Prisma.join(values)}
        ON CONFLICT (codigo) DO UPDATE SET
          nombre     = EXCLUDED.nombre,
          razon      = EXCLUDED.razon,
          direccion  = EXCLUDED.direccion,
          localidad  = EXCLUDED.localidad,
          contacto   = EXCLUDED.contacto,
          telefono   = EXCLUDED.telefono,
          fax        = EXCLUDED.fax,
          celular    = EXCLUDED.celular,
          "tipoIva"  = EXCLUDED."tipoIva",
          cuit       = EXCLUDED.cuit,
          cbu        = EXCLUDED.cbu,
          "aliasCbu" = EXCLUDED."aliasCbu",
          "diasVenc" = EXCLUDED."diasVenc",
          iva        = EXCLUDED.iva,
          "ivaDif"   = EXCLUDED."ivaDif",
          email      = EXCLUDED.email,
          observac   = EXCLUDED.observac,
          "detPerc"  = EXCLUDED."detPerc"
      `);

      for (const data of chunk) {
        if (existingSet.has(data.CODIGO)) updated++; else created++;
      }
    } catch (err) {
      errors.push({ rowIndex: i, rawCodigo: chunk[0]?.CODIGO, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return { created, updated, skipped, errors };
}
