import { Prisma } from "@prisma/client";
import type { DbClient } from "../types";
import { normalizeText, trim, toBool, normalizePhone, normalizeCuit } from "../helpers";
import type { ETLRow, ETLRowError } from "../types";

const CHUNK_SIZE = 500;

export async function normalizeProveedores(
  rows: ETLRow[],
  prisma: DbClient
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  const filtered = rows.filter((r) => trim(r["CODIGO"]) != null);
  const skipped = rows.length - filtered.length;

  const deduped = Array.from(
    filtered.reduce((m, r) => m.set(String(r["CODIGO"]).trim(), r), new Map<string, ETLRow>()).values()
  );

  const allCodigos = deduped.map((r) => String(r["CODIGO"]).trim());
  const existingSet = new Set(
    (await prisma.proveedor.findMany({ where: { codigo: { in: allCodigos } }, select: { codigo: true } }))
      .map((x) => x.codigo)
  );

  let created = 0, updated = 0;
  const errors: ETLRowError[] = [];

  for (let i = 0; i < deduped.length; i += CHUNK_SIZE) {
    const chunk = deduped.slice(i, i + CHUNK_SIZE);
    try {
      const values = chunk.map((r) => {
        const codigo = String(r["CODIGO"]).trim();
        const ivaVal = toBool(r["IVA"]);
        const ivaDifVal = toBool(r["IVA_DIF"]);
        return Prisma.sql`(
          ${codigo},
          ${normalizeText(r["NOMBRE"])},
          ${normalizeText(r["RAZON"])},
          ${normalizeText(r["DIRECCION"])},
          ${normalizeText(r["LOCALIDAD"])},
          ${normalizeText(r["CONTACTO"])},
          ${normalizePhone(r["TELEFONO"])},
          ${normalizePhone(r["FAX"])},
          ${normalizePhone(r["CELULAR"])},
          ${r["TIPO_IVA"] != null ? String(r["TIPO_IVA"]) : null},
          ${normalizeCuit(r["CUIT"])},
          ${trim(r["CBU"])},
          ${trim(r["ALIASCBU"])},
          ${r["DIAS_VENC"] != null ? Number(r["DIAS_VENC"]) : null},
          ${ivaVal != null ? (ivaVal ? 1 : 0) : null},
          ${ivaDifVal != null ? (ivaDifVal ? 1 : 0) : null},
          ${trim(r["E_MAIL"])},
          ${normalizeText(r["OBSERVAC"])},
          ${trim(r["DETPERC"])}
        )`;
      });

      await (prisma as unknown as { $executeRaw: (q: Prisma.Sql) => Promise<number> }).$executeRaw(Prisma.sql`
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

      for (const r of chunk) {
        if (existingSet.has(String(r["CODIGO"]).trim())) updated++; else created++;
      }
    } catch (err) {
      errors.push({ rowIndex: i, rawCodigo: chunk[0]?.["CODIGO"], message: err instanceof Error ? err.message : String(err) });
    }
  }

  return { created, updated, skipped, errors };
}
