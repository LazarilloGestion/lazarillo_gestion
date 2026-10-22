import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  refreshGoogleAccessToken,
  listDriveFiles,
  listDriveSubfolders,
  listFilesInSubfolders,
} from "@/lib/drive/client";
import { prisma } from "@/lib/prisma";
import type { DriveFilesResponse, DriveFolderWithFiles } from "@/lib/drive/types";

export const runtime = "nodejs";

// Nombre de la subcarpeta de maestros dentro de la carpeta configurada.
// Configurable por instancia: la carpeta "Informes ERP" del Drive tiene
// "Maestros" (Container) y "Maestros COMERCIO" (Comercio); cada Panel elige
// la suya con DRIVE_MAESTROS_FOLDER y comparte la misma carpeta raíz. Sin la
// variable queda "Maestros", como siempre.
const MAESTROS_NAME = process.env.DRIVE_MAESTROS_FOLDER?.trim() || "Maestros";
const TRANSACCIONALES_NAME = "Transaccionales";

function norm(s: string): string {
  return s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Parsea "Ramos - BAR Resto" → { localPart: "Ramos", pdvPart: "BAR Resto" } */
function parseFolderName(name: string): { localPart: string; pdvPart: string | null } {
  const idx = name.indexOf(" - ");
  if (idx === -1) return { localPart: name, pdvPart: null };
  return { localPart: name.slice(0, idx).trim(), pdvPart: name.slice(idx + 3).trim() };
}

type LocalWithPdvs = {
  id: number;
  nombre: string;
  puntosDeVenta: { id: number; nombre: string }[];
};

/**
 * Matchea por contenido (case-insensitive, sin tildes):
 * "Ramos" ⊂ "Ramos Mejía" → match
 * "Canchas" ⊂ "FC Canchas" → match
 */
function matchLocal(localPart: string, locales: LocalWithPdvs[]): LocalWithPdvs | null {
  const q = norm(localPart);
  return (
    locales.find((l) => norm(l.nombre).includes(q) || q.includes(norm(l.nombre))) ?? null
  );
}

function matchPdv(
  pdvPart: string,
  local: LocalWithPdvs
): { id: number; nombre: string } | null {
  const q = norm(pdvPart);
  return (
    local.puntosDeVenta.find(
      (p) => q.includes(norm(p.nombre)) || norm(p.nombre).includes(q)
    ) ?? null
  );
}

export async function GET() {
  const auth = await requireAuthUser();
  if (auth.response) return auth.response;
  const { user } = auth;

  const admin = getSupabaseAdmin();

  let config: { folder_id: string | null; refresh_token: string | null } | null;
  try {
    const { data, error } = await admin
      .from("user_drive_config")
      .select("folder_id, refresh_token")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    config = data;
  } catch (err) {
    console.error("[drive/files] Error consultando config:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }

  if (!config?.folder_id) {
    return NextResponse.json({ error: "Sin carpeta configurada" }, { status: 404 });
  }
  if (!config.refresh_token) {
    return NextResponse.json(
      { error: "Sin token de Drive. Cerrá sesión y volvé a entrar." },
      { status: 401 }
    );
  }

  try {
    const accessToken = await refreshGoogleAccessToken(config.refresh_token);

    // Nivel 1: subcarpetas raíz + locales de la BD en paralelo
    const [rootSubfolders, locales] = await Promise.all([
      listDriveSubfolders(accessToken, config.folder_id),
      prisma.local.findMany({ include: { puntosDeVenta: true } }) as Promise<LocalWithPdvs[]>,
    ]);

    // Identificar Maestros y Transaccionales
    const maestrosFolder = rootSubfolders.find((f) => norm(f.name) === norm(MAESTROS_NAME));
    const transaccionalesFolder = rootSubfolders.find(
      (f) => norm(f.name) === norm(TRANSACCIONALES_NAME)
    );

    // Archivos maestros + subcarpetas PDV en paralelo
    const [maestrosFiles, pdvSubfolders] = await Promise.all([
      maestrosFolder
        ? listDriveFiles(accessToken, maestrosFolder.id)
        : Promise.resolve([]),
      transaccionalesFolder
        ? listDriveSubfolders(accessToken, transaccionalesFolder.id)
        : Promise.resolve([]),
    ]);

    // Para cada carpeta PDV: recolectar todos los xlsx de sus sub-subcarpetas
    const pdvFilesArrays = await Promise.all(
      pdvSubfolders.map((f) => listFilesInSubfolders(accessToken, f.id))
    );

    // Resolver local + PDV por nombre de carpeta
    const folders: DriveFolderWithFiles[] = pdvSubfolders.map((folder, i) => {
      const { localPart, pdvPart } = parseFolderName(folder.name);
      const matchedLocal = matchLocal(localPart, locales);
      const matchedPdv =
        matchedLocal && pdvPart ? matchPdv(pdvPart, matchedLocal) : null;

      return {
        id: folder.id,
        name: folder.name,
        localId: matchedLocal?.id ?? null,
        localNombre: matchedLocal?.nombre ?? null,
        puntoDeVentaId: matchedPdv?.id ?? null,
        pdvNombre: matchedPdv?.nombre ?? null,
        files: pdvFilesArrays[i],
      };
    });

    // Orden por dependencias: articulos(6) depende de rubros(7) y subrubros(8) → va después.
    // concepto-caja(17) depende de rubros-concepto(11) → ya correcto por número.
    const depOrder = (name: string): number => {
      const n = parseInt(name) || 9999;
      if (n === 6) return 8.5; // articulos va después de rubros(7) y subrubros(8)
      return n;
    };
    const sortedMaestros = [...maestrosFiles].sort((a, b) => depOrder(a.name) - depOrder(b.name));
    const response: DriveFilesResponse = { maestros: sortedMaestros, folders };
    return NextResponse.json(response);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
