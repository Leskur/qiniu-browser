import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

export function PageToolbar({ className, bordered = true, ...props }: ComponentProps<"div"> & {
  bordered?: boolean;
}) {
  return (
    <div data-slot="page-toolbar"
      className={cn(
        "flex h-12 shrink-0 items-center gap-2 px-6 [&_button]:rounded-lg",
        bordered && "border-b border-border",
        className,
      )}
      {...props} />
  );
}
