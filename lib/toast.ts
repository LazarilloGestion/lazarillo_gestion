import { toast } from "sonner";

export const notify = {
  registroActualizado: () => toast.success("Registro actualizado"),

  errorGuardar: () => toast.error("No se pudo guardar. Intentá de nuevo."),

  errorActualizar: (nombre: string) =>
    toast.error(`No se pudo actualizar ${nombre}. Intentá de nuevo.`),

  rubroVisibilidad: (nombre: string, visible: boolean) =>
    toast.success(visible ? `${nombre} visible en panel` : `${nombre} ocultado del panel`),

  importacionCompletada: (totalFiles: number, totalRecords: number) =>
    toast.success("Importación completada", {
      description: `${totalFiles} archivo${totalFiles !== 1 ? "s" : ""} procesados · ${totalRecords} registros`,
      duration: Infinity,
    }),

  importacionConErrores: (totalErrors: number, totalFiles: number) =>
    toast.error("Importación con errores", {
      description: `${totalErrors} de ${totalFiles} archivo${totalFiles !== 1 ? "s" : ""} fallaron — revisá los detalles`,
      duration: Infinity,
    }),

  maestrosNoCargados: (totalFiles: number) =>
    toast.warning("Maestros no cargados", {
      description:
        totalFiles > 0
          ? `Se procesaron ${totalFiles} archivo${totalFiles !== 1 ? "s" : ""} maestros pero los transaccionales no se importaron`
          : "Los archivos transaccionales no se importaron — los maestros no están disponibles",
      duration: Infinity,
    }),
};
