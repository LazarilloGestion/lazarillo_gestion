export interface DestinoPct {
  id: number;
  porcentaje: number;
}

export interface DistribucionCalculada {
  destinoId: number;
  importeCalculado: number;
}

// Reparto "el último se lleva el resto": evita que el redondeo a centavos
// pierda o sobre-asigne unos pocos centavos — invariante no negociable de la
// spec funcional (sección "Principios no negociables": suma de distribuciones
// = importe original, exacto). Los destinos se ordenan por id para que el
// resultado sea determinístico y reproducible entre corridas.
export function calcularDistribuciones(importeBase: number, destinos: DestinoPct[]): DistribucionCalculada[] {
  const ordenados = [...destinos].sort((a, b) => a.id - b.id);
  const resultado: DistribucionCalculada[] = [];
  let acumulado = 0;

  ordenados.forEach((d, i) => {
    const esUltimo = i === ordenados.length - 1;
    const importeCalculado = esUltimo
      ? Math.round((importeBase - acumulado) * 100) / 100
      : Math.round(((importeBase * d.porcentaje) / 100) * 100) / 100;
    acumulado += importeCalculado;
    resultado.push({ destinoId: d.id, importeCalculado });
  });

  return resultado;
}
