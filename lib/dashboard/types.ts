export type PivotProveedorRow = {
  level: 2;
  id: string;
  nombre: string;
  proveedorId: number | null;
  conceptoCodigo: string;
  rubroCodigo: string;
  values: Record<number, number>;
  rowTotal: number;
};

export type PivotConceptoRow = {
  level: 1;
  id: string;
  nombre: string;
  conceptoCodigo: string;
  rubroCodigo: string;
  values: Record<number, number>;
  rowTotal: number;
  children: PivotProveedorRow[];
};

export type PivotRubroRow = {
  level: 0;
  id: string;
  nombre: string;
  rubroCodigo: string;
  values: Record<number, number>;
  rowTotal: number;
  children: PivotConceptoRow[];
};

export type PivotData = {
  rows: PivotRubroRow[];
  columnTotals: Record<number, number>;
  grandTotal: number;
};

export type DetalleFilter = {
  year: number;
  localId?: number;
  pdvId?: number;
  mes?: number;
  rubroCodigo?: string;
  conceptoCodigo?: string;
  proveedorId?: number;
};
