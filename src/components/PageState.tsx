import type { ReactNode } from "react";
import { AlertCircle, Loader2, type LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";

export function PageState({ title, description, icon: Icon, loading = false, error = false, children, className }: {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  loading?: boolean;
  error?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const StateIcon = loading ? Loader2 : error ? AlertCircle : Icon;
  return (
    <div role={error ? "alert" : loading ? "status" : undefined}
      className={cn("flex h-full min-h-48 w-full flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center", className)}>
      {StateIcon && <StateIcon aria-hidden="true" className={cn(
        "size-8 shrink-0 text-muted-foreground/60",
        loading && "size-6 animate-spin text-muted-foreground",
        error && "text-destructive",
      )} />}
      <div className="max-w-sm space-y-1">
        <p className={cn("text-sm font-medium text-foreground", error && "text-destructive")}>{title}</p>
        {description && <div className="break-words text-xs leading-relaxed text-muted-foreground">{description}</div>}
      </div>
      {children && <div className="flex flex-wrap items-center justify-center gap-2">{children}</div>}
    </div>
  );
}
