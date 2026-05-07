import type { PrismaClient } from "@prisma/client";
import { normalizeText, trim, toBool } from "../helpers";
import type { ETLRow, ETLRowError } from "../types";

export async function normalizeProveedores(
  rows: ETLRow[],
  prisma: PrismaClient
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  let created = 0, updated = 0;
  const errors: ETLRowError[] = [];

  const filtered = rows.filter((r) => r["ID"] != null);
  const skipped = rows.length - filtered.length;

  for (let i = 0; i < filtered.length; i++) {
    const r = filtered[i];
    const rawCodigo = r["CODIGO"];
    try {
      const codigo = String(rawCodigo);
      const data = {
        nombre: normalizeText(r["NOMBRE"]),
        razon: normalizeText(r["RAZON"]),
        direccion: normalizeText(r["DIRECCION"]),
        localidad: normalizeText(r["LOCALIDAD"]),
        contacto: normalizeText(r["CONTACTO"]),
        telefono: trim(r["TELEFONO"]),
        fax: trim(r["FAX"]),
        celular: trim(r["CELULAR"]),
        tipoIva: r["TIPO_IVA"] != null ? String(r["TIPO_IVA"]) : null,
        cuit: trim(r["CUIT"]),
        cbu: trim(r["CBU"]),
        aliasCbu: trim(r["ALIASCBU"]),
        diasVenc: r["DIAS_VENC"] != null ? Number(r["DIAS_VENC"]) : null,
        iva: toBool(r["IVA"]) != null ? (toBool(r["IVA"]) ? 1 : 0) : null,
        ivaDif: toBool(r["IVA_DIF"]) != null ? (toBool(r["IVA_DIF"]) ? 1 : 0) : null,
        email: trim(r["E_MAIL"]),
        observac: normalizeText(r["OBSERVAC"]),
        detPerc: trim(r["DETPERC"]),
      };
      const existing = await prisma.proveedor.findUnique({
        where: { codigo },
        select: { codigo: true },
      });
      await prisma.proveedor.upsert({
        where: { codigo },
        update: data,
        create: { codigo, ...data },
      });
      if (existing) updated++; else created++;
    } catch (err) {
      errors.push({
        rowIndex: i,
        rawCodigo,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { created, updated, skipped, errors };
}
