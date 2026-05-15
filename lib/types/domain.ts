export interface PuntoDeVenta {
  id: number;
  nombre: string;
}

export interface Local {
  id: number;
  nombre: string;
  puntosDeVenta: PuntoDeVenta[];
}
