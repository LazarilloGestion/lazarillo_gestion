import * as XLSX from "xlsx";
import * as path from "path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// ─── Config ──────────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL!;

const adapter = new PrismaPg({ connectionString: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const LOCAL_SEED_DIR =
  process.env.SEED_DIR ||
  path.join(process.env.HOME!, "Downloads", "Diego Albo", "seedsVersion1");

const BUCKET = "seeds";
const VERSION = "version_1";
const TMP_DIR = path.join(process.cwd(), "scripts", ".tmp");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function trim(val: unknown): string | null {
  if (val == null) return null;
  const s = String(val).trim();
  return s === "" ? null : s;
}

function toDecimal(val: unknown): number | null {
  if (val == null || val === "" || val === " ") return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function toBool(val: unknown): boolean | null {
  if (val == null) return null;
  if (typeof val === "boolean") return val;
  if (val === 1 || val === "1" || val === "true") return true;
  if (val === 0 || val === "0" || val === "false") return false;
  return null;
}

function excelDateToISO(val: unknown): string | null {
  if (val == null || val === false || val === "") return null;
  if (typeof val === "number") {
    const date = XLSX.SSF.parse_date_code(val);
    return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
  }
  return null;
}

function readExcel(filePath: string): Record<string, unknown>[] {
  const wb = XLSX.readFile(filePath);
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
}

function localPath(filename: string): string {
  return path.join(LOCAL_SEED_DIR, filename);
}

// ─── Seeders ─────────────────────────────────────────────────────────────────

async function seedRubrosConceptoCaja(filePath: string) {
  const rows = readExcel(filePath).filter((r) => r["ID"] != null);
  console.log(`  ${rows.length} rubros de concepto de caja`);

  for (const r of rows) {
    await prisma.rubroConceptoCaja.upsert({
      where: { codigo: String(r["CODIGO"]) },
      update: {
        nombre: trim(r["NOMBRE"])!,
        calcRent: r["CALC_RENT"] != null ? String(r["CALC_RENT"]) : null,
      },
      create: {
        codigo: String(r["CODIGO"]),
        nombre: trim(r["NOMBRE"])!,
        calcRent: r["CALC_RENT"] != null ? String(r["CALC_RENT"]) : null,
      },
    });
  }
}

async function seedRubrosArticulo(filePath: string) {
  const rows = readExcel(filePath).filter((r) => r["ID"] != null);
  console.log(`  ${rows.length} rubros de artículo`);

  for (const r of rows) {
    await prisma.rubroArticulo.upsert({
      where: { codigo: String(r["CODIGO"]) },
      update: {
        nombre: trim(r["NOMBRE"])!,
        color: trim(r["COLOR"]),
        grupoNro: trim(r["GRUPO_NRO"]),
        grupoCol: trim(r["GRUPO_COL"]),
        grupoFot: trim(r["GRUPO_FOT"]),
        excluyeInf: toBool(r["EXCLUYEINF"]),
        evento: trim(r["EVENTO"]),
        deliAct: toBool(r["DELIACT"]),
        eveFor: trim(r["EVE_FOR"]),
        eveForm: trim(r["EVE_FORM"]),
        eveFormH: trim(r["EVE_FORMH"]),
        discont: toDecimal(r["DISCONT"]),
        fechaUpda: excelDateToISO(r["FECHA_UPDA"])
          ? new Date(excelDateToISO(r["FECHA_UPDA"])!)
          : null,
        modoVista: trim(r["MODO_VISTA"]),
      },
      create: {
        codigo: String(r["CODIGO"]),
        nombre: trim(r["NOMBRE"])!,
        color: trim(r["COLOR"]),
        grupoNro: trim(r["GRUPO_NRO"]),
        grupoCol: trim(r["GRUPO_COL"]),
        grupoFot: trim(r["GRUPO_FOT"]),
        excluyeInf: toBool(r["EXCLUYEINF"]),
        evento: trim(r["EVENTO"]),
        deliAct: toBool(r["DELIACT"]),
        eveFor: trim(r["EVE_FOR"]),
        eveForm: trim(r["EVE_FORM"]),
        eveFormH: trim(r["EVE_FORMH"]),
        discont: toDecimal(r["DISCONT"]),
        fechaUpda: excelDateToISO(r["FECHA_UPDA"])
          ? new Date(excelDateToISO(r["FECHA_UPDA"])!)
          : null,
        modoVista: trim(r["MODO_VISTA"]),
      },
    });
  }
}

async function seedSubrubrosArticulo(filePath: string) {
  const rows = readExcel(filePath).filter((r) => r["ID"] != null);
  console.log(`  ${rows.length} subrubros de artículo`);

  for (const r of rows) {
    await prisma.subrubroArticulo.upsert({
      where: { codigo: String(r["CODIGO"]) },
      update: {
        nombre: trim(r["NOMBRE"])!,
        deliAct: toBool(r["DELIACT"]),
        eveFor: trim(r["EVE_FOR"]),
        eveForm: trim(r["EVE_FORM"]),
        eveFormH: trim(r["EVE_FORMH"]),
        fechaUpda: excelDateToISO(r["FECHA_UPDA"])
          ? new Date(excelDateToISO(r["FECHA_UPDA"])!)
          : null,
      },
      create: {
        codigo: String(r["CODIGO"]),
        nombre: trim(r["NOMBRE"])!,
        deliAct: toBool(r["DELIACT"]),
        eveFor: trim(r["EVE_FOR"]),
        eveForm: trim(r["EVE_FORM"]),
        eveFormH: trim(r["EVE_FORMH"]),
        fechaUpda: excelDateToISO(r["FECHA_UPDA"])
          ? new Date(excelDateToISO(r["FECHA_UPDA"])!)
          : null,
      },
    });
  }
}

async function seedConceptosCaja(filePath: string) {
  const rows = readExcel(filePath).filter((r) => r["ID"] != null);
  console.log(`  ${rows.length} conceptos de caja`);

  for (const r of rows) {
    await prisma.conceptoCaja.upsert({
      where: { codigo: String(r["CODIGO"]) },
      update: {
        nombre: trim(r["NOMBRE"]) ?? "(sin nombre)",
        tipo: trim(r["TIPO"]),
        codImp: trim(r["COD_IMP"]),
        codRga: r["COD_RGA"] != null && Number(r["COD_RGA"]) > 0
          ? String(r["COD_RGA"])
          : null,
      },
      create: {
        codigo: String(r["CODIGO"]),
        nombre: trim(r["NOMBRE"]) ?? "(sin nombre)",
        tipo: trim(r["TIPO"]),
        codImp: trim(r["COD_IMP"]),
        codRga: r["COD_RGA"] != null && Number(r["COD_RGA"]) > 0
          ? String(r["COD_RGA"])
          : null,
      },
    });
  }
}

async function seedArticulos(filePath: string) {
  const rows = readExcel(filePath).filter((r) => r["CODIGO"] != null);
  console.log(`  ${rows.length} artículos`);

  for (const r of rows) {
    await prisma.articulo.upsert({
      where: { codigo: String(r["CODIGO"]) },
      update: {
        nombre: trim(r["NOMBRE"])!,
        precio1: toDecimal(r["PRECIO1"]),
        precio2: toDecimal(r["PRECIO2"]),
        precio3: toDecimal(r["PRECIO3"]),
        precio4: toDecimal(r["PRECIO4"]),
        codRua: r["COD_RUA"] != null && Number(r["COD_RUA"]) > 0
          ? String(r["COD_RUA"])
          : null,
        codSua: r["COD_SUA"] != null && Number(r["COD_SUA"]) > 0
          ? String(r["COD_SUA"])
          : null,
      },
      create: {
        codigo: String(r["CODIGO"]),
        nombre: trim(r["NOMBRE"])!,
        precio1: toDecimal(r["PRECIO1"]),
        precio2: toDecimal(r["PRECIO2"]),
        precio3: toDecimal(r["PRECIO3"]),
        precio4: toDecimal(r["PRECIO4"]),
        codRua: r["COD_RUA"] != null && Number(r["COD_RUA"]) > 0
          ? String(r["COD_RUA"])
          : null,
        codSua: r["COD_SUA"] != null && Number(r["COD_SUA"]) > 0
          ? String(r["COD_SUA"])
          : null,
      },
    });
  }
}

async function seedProveedores(filePath: string) {
  const rows = readExcel(filePath).filter((r) => r["ID"] != null);
  console.log(`  ${rows.length} proveedores`);

  for (const r of rows) {
    await prisma.proveedor.upsert({
      where: { codigo: String(r["CODIGO"]) },
      update: {
        nombre: trim(r["NOMBRE"]),
        razon: trim(r["RAZON"]),
        direccion: trim(r["DIRECCION"]),
        localidad: trim(r["LOCALIDAD"]),
        contacto: trim(r["CONTACTO"]),
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
        observac: trim(r["OBSERVAC"]),
        detPerc: trim(r["DETPERC"]),
      },
      create: {
        codigo: String(r["CODIGO"]),
        nombre: trim(r["NOMBRE"]),
        razon: trim(r["RAZON"]),
        direccion: trim(r["DIRECCION"]),
        localidad: trim(r["LOCALIDAD"]),
        contacto: trim(r["CONTACTO"]),
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
        observac: trim(r["OBSERVAC"]),
        detPerc: trim(r["DETPERC"]),
      },
    });
  }
}

async function seedLocalesYPuntosDeVenta() {
  console.log("  Seeding locales y puntos de venta...");

  const locales = [
    { nombre: "Ramos Mejía", puntos: ["Bar", "Canchas"] },
    { nombre: "San Justo", puntos: ["Bar", "Canchas"] },
  ];

  for (const { nombre, puntos } of locales) {
    const local = await prisma.local.upsert({
      where: { nombre },
      update: {},
      create: { nombre },
    });

    for (const puntoNombre of puntos) {
      await prisma.puntoDeVenta.upsert({
        where: { nombre_localId: { nombre: puntoNombre, localId: local.id } },
        update: {},
        create: { nombre: puntoNombre, localId: local.id },
      });
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Seed Maestros v1 ===\n");
  console.log(`Leyendo desde: ${LOCAL_SEED_DIR}\n`);

  console.log("[1/7] RubrosConceptoCaja");
  await seedRubrosConceptoCaja(localPath("rubrosConceptosDeCajaV7.XLSX"));

  console.log("\n[2/7] RubrosArticulo");
  await seedRubrosArticulo(localPath("rubrosDeArticulosV7.XLSX"));

  console.log("\n[3/7] SubrubrosArticulo");
  await seedSubrubrosArticulo(localPath("subrubroDe ArticulosV7.XLSX"));

  console.log("\n[4/7] ConceptosCaja");
  await seedConceptosCaja(localPath("conceptosDeCajaV7.XLSX"));

  console.log("\n[5/7] Articulos");
  await seedArticulos(localPath("listadoDeArticulosV7.XLSX"));

  console.log("\n[6/7] Proveedores");
  await seedProveedores(localPath("proovedoresV7.XLSX"));

  console.log("\n[7/7] Locales y Puntos de Venta (R-004)");
  await seedLocalesYPuntosDeVenta();

  console.log("\n✓ Seed completado.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
