import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const sizeMap = { sm: "size-3.5", md: "size-4", lg: "size-6" };

export function Spinner({ size = "md", className }: { size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <Loader2 className={cn("animate-spin text-muted-foreground", sizeMap[size], className)} />
  );
}
