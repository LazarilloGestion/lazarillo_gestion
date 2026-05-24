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
