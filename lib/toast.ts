import { toast } from "sonner";

export const notify = {
  registroActualizado: () => toast.success("Registro actualizado"),

  errorGuardar: () => toast.error("No se pudo guardar. Intentá de nuevo."),

  arqueoCeroInvalido: () =>
    toast.warning("Un arqueo en $0 no es un dato", {
      description: "Dejá la celda vacía si no hubo arqueo ese mes.",
    }),

  aperturaSinCompras: () =>
    toast.warning("Regla guardada, pero no afectó ninguna compra", {
      description: "Revisá el origen y la vigencia — puede que no haya compras que coincidan todavía.",
    }),

  errorActualizar: (nombre: string) =>
    toast.error(`No se pudo actualizar ${nombre}. Intentá de nuevo.`),

  rubroVisibilidad: (nombre: string, visible: boolean) =>
    toast.success(visible ? `${nombre} visible en panel` : `${nombre} ocultado del panel`),

  importacionCompletada: (totalFiles: number, totalRecords: number) =>
    toast.success("Importación completada", {
      description: `${totalFiles} archivo${totalFiles !== 1 ? "s" : ""} procesados · ${totalRecords} registros`,
      duration: Infinity,
      closeButton: true,
    }),

  importacionConErrores: (totalErrors: number, totalFiles: number) =>
    toast.error("Importación con errores", {
      description: `${totalErrors} de ${totalFiles} archivo${totalFiles !== 1 ? "s" : ""} fallaron — revisá los detalles`,
      duration: Infinity,
      closeButton: true,
    }),

  maestrosNoCargados: (totalFiles: number) =>
    toast.warning("Maestros no cargados", {
      description:
        totalFiles > 0
          ? `Se procesaron ${totalFiles} archivo${totalFiles !== 1 ? "s" : ""} maestros pero los transaccionales no se importaron`
          : "Los archivos transaccionales no se importaron — los maestros no están disponibles",
      duration: Infinity,
      closeButton: true,
    }),

  localNoReconocido: (count: number) =>
    toast.warning("Carpetas no importadas", {
      description: `${count} carpeta${count !== 1 ? "s" : ""} omitida${count !== 1 ? "s" : ""} — el nombre no corresponde a ningún local registrado`,
      duration: Infinity,
      closeButton: true,
    }),

  archivosNoSoportados: (count: number) =>
    toast.warning("Archivos no soportados", {
      description: `${count} archivo${count !== 1 ? "s" : ""} no ${count !== 1 ? "fueron reconocidos" : "fue reconocido"} por el sistema y se ${count !== 1 ? "ignoraron" : "ignoró"} — el resto de la importación no se vio afectado`,
      duration: Infinity,
      closeButton: true,
    }),

  aperturaSincronizacionConErrores: (count: number) =>
    toast.warning("Apertura de gastos — sincronización con errores", {
      description: `${count} error${count !== 1 ? "es" : ""} al recalcular/aplicar reglas de apertura tras el import — revisá los detalles en el servidor`,
      duration: Infinity,
      closeButton: true,
    }),

  aperturaSincronizacionOmitidas: (count: number) =>
    toast.info("Apertura de gastos — cambios no recalculados", {
      description: `${count} compra${count !== 1 ? "s" : ""} con datos del ERP actualizados no se recalcularon porque su regla de apertura está desactivada — el historial de distribución se preservó tal cual.`,
      duration: Infinity,
      closeButton: true,
    }),
};
