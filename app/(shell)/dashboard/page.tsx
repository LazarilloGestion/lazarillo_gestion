import { Suspense } from "react";
import { DashboardFilters } from "@/components/dashboard/dashboard-filters";
import { PivotTable } from "@/components/dashboard/pivot-table";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardPage() {
  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">Dashboard de Compras</h1>
        <p className="text-sm text-muted-foreground">
          Vista anual por rubro, concepto y proveedor
        </p>
      </div>

      <Suspense fallback={<FiltersSkeleton />}>
        <DashboardFilters />
      </Suspense>

      <div className="bg-background rounded-xl border shadow-sm overflow-hidden">
        <Suspense fallback={<TableSkeleton />}>
          <PivotTable />
        </Suspense>
      </div>
    </div>
  );
}

function FiltersSkeleton() {
  return (
    <div className="flex gap-3">
      <Skeleton className="h-8 w-24" />
      <Skeleton className="h-8 w-44" />
    </div>
  );
}

function TableSkeleton() {
  return (
    <div>
      <div className="bg-muted/40 h-10 border-b" />
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="border-b px-4 py-3 flex items-center gap-4">
          <Skeleton className="h-3.5 w-36" />
          <div className="flex-1 flex justify-end gap-6">
            {Array.from({ length: 5 }).map((_, j) => (
              <Skeleton key={j} className="h-3.5 w-14" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
