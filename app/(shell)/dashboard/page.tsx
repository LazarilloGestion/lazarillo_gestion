import type { Metadata } from "next";
import { DashboardFilters } from "@/components/dashboard/dashboard-filters";
import { DashboardTabContent } from "@/components/dashboard/dashboard-tab-content";
import { DashboardSubtitle } from "@/components/dashboard/dashboard-subtitle";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Dashboard | Lazarillo Gestión",
};

export default function DashboardPage() {
  return (
    <div className="flex flex-col h-full p-6 gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">
          Dashboard
        </h1>
        <DashboardSubtitle />
      </div>

      <DashboardFilters />

      <div className="flex-1 min-h-0 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden flex flex-col">
        <DashboardTabContent />
      </div>
    </div>
  );
}

export function FiltersSkeleton() {
  return (
    <div className="flex gap-3">
      <Skeleton className="h-8 w-24" />
      <Skeleton className="h-8 w-44" />
    </div>
  );
}

export function TableSkeleton() {
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
