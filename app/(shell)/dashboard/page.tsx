import { Suspense } from "react";
import { DashboardFilters } from "@/components/dashboard/dashboard-filters";
import { PivotTable } from "@/components/dashboard/pivot-table";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard de Compras</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Vista anual por rubro, concepto y proveedor
        </p>
      </div>

      <Suspense fallback={<FiltersSkeleton />}>
        <DashboardFilters />
      </Suspense>

      <Suspense fallback={<TableSkeleton />}>
        <PivotTable />
      </Suspense>
    </div>
  );
}

function FiltersSkeleton() {
  return (
    <div className="flex gap-3">
      <Skeleton className="h-9 w-28" />
      <Skeleton className="h-9 w-44" />
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="bg-muted/50 h-10" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="border-t px-3 py-2.5 flex gap-2">
          <Skeleton className="h-4 w-40" />
          <div className="flex-1 flex justify-end gap-4">
            {Array.from({ length: 4 }).map((_, j) => (
              <Skeleton key={j} className="h-4 w-16" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
