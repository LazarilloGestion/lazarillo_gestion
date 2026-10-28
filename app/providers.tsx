"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { REINTENTOS } from "@/lib/query-retry";

export function Providers({ children }: { children: React.ReactNode }) {
  // Reintentos acotados para todas las consultas (ver lib/query-retry.ts).
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { ...REINTENTOS } } }));
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
