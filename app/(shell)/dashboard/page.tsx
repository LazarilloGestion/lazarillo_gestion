import type { Metadata } from "next";
import { Suspense } from "react";
import { DashboardFilters } from "@/components/dashboard/dashboard-filters";
import { DashboardTabContent } from "@/components/dashboard/dashboard-tab-content";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Dashboard | Lazarillo Gestión",
};

const SUBTITLES: Record<string, string> = {
  compras: "Vista anual por rubro / tipo de cobro",
  ventas: "Vista anual por punto de venta / tipo de cobro",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const tab = typeof params.tab === "string" ? params.tab : "compras";
  const subtitle = SUBTITLES[tab] ?? SUBTITLES.compras;

  return (
    <div className="flex flex-col h-full p-6 gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">
          Dashboard
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>
      </div>

      <Suspense fallback={<FiltersSkeleton />}>
        <DashboardFilters />
      </Suspense>

      <div className="flex-1 min-h-0 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden flex flex-col">
        <Suspense fallback={<TableSkeleton />}>
          <DashboardTabContent />
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
      <div className="bg-zinc-50 dark:bg-zinc-800 h-10 border-b border-zinc-100 dark:border-zinc-700" />
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="border-b border-zinc-100 dark:border-zinc-700/50 px-4 py-3 flex items-center gap-4">
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
