"use client";
import { ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface ExpandableButtonProps {
  isExpanded: boolean;
  onClick: () => void;
  children: React.ReactNode;
  indent?: string;
  iconSize?: string;
}

export function ExpandableButton({
  isExpanded,
  onClick,
  children,
  indent,
  iconSize = "w-4 h-4",
}: ExpandableButtonProps) {
  return (
    <button
      className={cn(
        "flex items-center gap-1.5 w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded",
        indent
      )}
      onClick={onClick}
      aria-expanded={isExpanded}
    >
      {isExpanded ? (
        <ChevronDown className={cn(iconSize, "shrink-0 text-muted-foreground")} />
      ) : (
        <ChevronRight className={cn(iconSize, "shrink-0 text-muted-foreground")} />
      )}
      {children}
    </button>
  );
}
