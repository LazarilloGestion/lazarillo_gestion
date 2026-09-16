// Lee un campo de un blob de zustand persist ({ state: {...} }) de forma
// sincrónica, para poder seedear el valor inicial de un store SIN esperar
// a un useEffect (elimina el parpadeo de campos "chrome" como sidebarOpen
// y showFilters). El grupo de "datos" del dashboard sigue usando el
// rehydrate() asíncrono existente — acá solo se cubre el caso de cero
// parpadeo.
type StorageLike = Pick<Storage, "getItem">;

function defaultStorage(): StorageLike | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

export function readPersistedField<T>(
  storageKey: string,
  field: string,
  defaultValue: T,
  storage: StorageLike | undefined = defaultStorage()
): T {
  if (!storage) return defaultValue;
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return defaultValue;
    const parsed = JSON.parse(raw) as { state?: Record<string, unknown> };
    const value = parsed.state?.[field];
    return value === undefined ? defaultValue : (value as T);
  } catch {
    return defaultValue;
  }
}
