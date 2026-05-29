import { env } from "@/lib/env";
import type { DriveFile } from "./types";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

const DRIVE_ID_RE = /^[a-zA-Z0-9_-]+$/;

function assertValidDriveId(id: string, label: string): void {
  if (!DRIVE_ID_RE.test(id)) throw new Error(`${label} de Drive inválido`);
}

/** Obtiene un access token fresco usando el refresh token almacenado. */
export async function refreshGoogleAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("[drive/client] Error renovando token de Google:", body);
    throw new Error("Token de Drive inválido o revocado");
  }

  const json = await res.json() as { access_token?: string };
  if (!json.access_token) {
    console.error("[drive/client] Respuesta de Google sin access_token");
    throw new Error("Token de Drive inválido o revocado");
  }
  return json.access_token;
}

/** Lista archivos .xlsx / .xls en una carpeta Drive. */
export async function listDriveFiles(
  accessToken: string,
  folderId: string
): Promise<DriveFile[]> {
  assertValidDriveId(folderId, "folder_id");

  const q = `'${folderId}' in parents and (name contains '.xlsx' or name contains '.xls') and trashed = false`;
  const fields = "files(id,name,modifiedTime,size)";
  const url = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&orderBy=modifiedTime+desc`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("[drive/client] Error listando archivos Drive:", res.status, body);
    throw new Error(`Error listando archivos Drive: ${res.status}`);
  }

  const json = await res.json() as { files: DriveFile[] };
  return json.files ?? [];
}

/** Descarga el contenido binario de un archivo Drive. */
export async function downloadDriveFile(
  accessToken: string,
  fileId: string
): Promise<Buffer> {
  assertValidDriveId(fileId, "file_id");

  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("[drive/client] Error descargando archivo Drive:", res.status, body);
    throw new Error(`Error descargando archivo Drive: ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** Lista subcarpetas directas de una carpeta Drive. */
export async function listDriveSubfolders(
  accessToken: string,
  folderId: string
): Promise<{ id: string; name: string }[]> {
  assertValidDriveId(folderId, "folder_id");

  const q = `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const fields = "files(id,name)";
  const url = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&orderBy=name`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("[drive/client] Error listando subcarpetas Drive:", res.status, body);
    throw new Error(`Error listando subcarpetas Drive: ${res.status}`);
  }

  const json = await res.json() as { files: { id: string; name: string }[] };
  return json.files ?? [];
}

/**
 * Lista todos los archivos .xlsx/.xls dentro de las subcarpetas directas de folderId.
 * Útil para recolectar archivos de Compras/, Detalle Compras/, Ventas/ sin saber sus nombres.
 */
export async function listFilesInSubfolders(
  accessToken: string,
  folderId: string
): Promise<DriveFile[]> {
  const subfolders = await listDriveSubfolders(accessToken, folderId);
  if (subfolders.length === 0) {
    // Fallback: si no hay subcarpetas, listar archivos directos
    return listDriveFiles(accessToken, folderId);
  }
  const results = await Promise.all(
    subfolders.map((sf) => listDriveFiles(accessToken, sf.id))
  );
  return results.flat();
}

/** Obtiene el nombre de una carpeta Drive por su ID. */
export async function getDriveFolderName(
  accessToken: string,
  folderId: string
): Promise<string> {
  assertValidDriveId(folderId, "folder_id");

  const res = await fetch(`${DRIVE_API}/files/${folderId}?fields=name`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) return folderId;
  const json = await res.json() as { name: string };
  return json.name ?? folderId;
}
