import type { DbClient } from "../types";
import { normalizeText, trim, toBool, normalizePhone, normalizeCuit } from "../helpers";
import { processBatch } from "../normalizer-utils";
import type { ETLRow, ETLRowError } from "../types";

export async function normalizeProveedores(
  rows: ETLRow[],
  prisma: DbClient
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  let created = 0, updated = 0;

  const filtered = rows.filter((r) => {
    const c = trim(r["CODIGO"]);
    return c != null && c !== "";
  });
  const skipped = rows.length - filtered.length;

  const allCodigos = filtered.map((r) => String(r["CODIGO"]).trim());
  const existingCodigos = new Set(
    (await prisma.proveedor.findMany({
      where: { codigo: { in: allCodigos } },
      select: { codigo: true },
    })).map((x) => x.codigo)
  );

  const errors = await processBatch(
    filtered,
    async (r) => {
      const codigo = String(r["CODIGO"]).trim();
      const ivaVal = toBool(r["IVA"]);
      const ivaDifVal = toBool(r["IVA_DIF"]);
      const data = {
        nombre: normalizeText(r["NOMBRE"]),
        razon: normalizeText(r["RAZON"]),
        direccion: normalizeText(r["DIRECCION"]),
        localidad: normalizeText(r["LOCALIDAD"]),
        contacto: normalizeText(r["CONTACTO"]),
        telefono: normalizePhone(r["TELEFONO"]),
        fax: normalizePhone(r["FAX"]),
        celular: normalizePhone(r["CELULAR"]),
        tipoIva: r["TIPO_IVA"] != null ? String(r["TIPO_IVA"]) : null,
        cuit: normalizeCuit(r["CUIT"]),
        cbu: trim(r["CBU"]),
        aliasCbu: trim(r["ALIASCBU"]),
        diasVenc: r["DIAS_VENC"] != null ? Number(r["DIAS_VENC"]) : null,
        iva: ivaVal != null ? (ivaVal ? 1 : 0) : null,
        ivaDif: ivaDifVal != null ? (ivaDifVal ? 1 : 0) : null,
        email: trim(r["E_MAIL"]),
        observac: normalizeText(r["OBSERVAC"]),
        detPerc: trim(r["DETPERC"]),
      };
      await prisma.proveedor.upsert({
        where: { codigo },
        update: data,
        create: { codigo, ...data },
      });
      if (existingCodigos.has(codigo)) updated++; else created++;
    },
    (r) => r["CODIGO"]
  );

  return { created, updated, skipped, errors };
}
