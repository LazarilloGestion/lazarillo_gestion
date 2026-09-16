import type { Metadata } from "next";
import { DashboardContent } from "@/components/dashboard/dashboard-content";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Panel de Gestión | Lazarillo Gestión",
};

export default function DashboardPage() {
  return <DashboardContent />;
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
