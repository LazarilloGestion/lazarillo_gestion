import { Suspense } from "react";
import { DashboardFilters } from "@/components/dashboard/dashboard-filters";
import { PivotTable } from "@/components/dashboard/pivot-table";

export default function DashboardPage() {
  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Dashboard de Compras</h1>
      <Suspense fallback={null}>
        <DashboardFilters />
      </Suspense>
      <Suspense
        fallback={
          <div className="text-sm text-muted-foreground py-12 text-center">
            Cargando...
          </div>
        }
      >
        <PivotTable />
      </Suspense>
    </main>
  );
}
