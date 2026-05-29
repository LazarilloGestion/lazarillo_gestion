export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  size: string;
}

export interface DriveConfig {
  folder_id: string | null;
  folder_name: string | null;
}

export interface DriveFolderWithFiles {
  id: string;
  name: string;
  localId: number | null;
  localNombre: string | null;
  puntoDeVentaId: number | null;
  pdvNombre: string | null;
  files: DriveFile[];
}

export interface DriveFilesResponse {
  maestros: DriveFile[];
  folders: DriveFolderWithFiles[];
}
