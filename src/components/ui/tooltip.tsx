import type { ReactElement, ReactNode } from "react"
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"
import { cn } from "@/lib/utils"

type TooltipProps = {
  content?: ReactNode
  children: ReactElement
  side?: TooltipPrimitive.Positioner.Props["side"]
  className?: string
}

function TooltipProvider({ children }: { children: ReactNode }) {
  return <TooltipPrimitive.Provider delay={400}>{children}</TooltipPrimitive.Provider>
}

function Tooltip({ content, children, side = "top", className }: TooltipProps) {
  if (!content) return children

  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger render={children} />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner side={side} sideOffset={8} className="z-[100]">
          <TooltipPrimitive.Popup
            data-slot="tooltip"
            className={cn(
              "max-w-[min(24rem,var(--available-width))] origin-(--transform-origin) rounded-lg bg-popover px-2.5 py-1.5 text-xs leading-relaxed text-popover-foreground shadow-md ring-1 ring-border break-words data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 duration-100",
              className
            )}
          >
            {content}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

export { Tooltip, TooltipProvider, type TooltipProps }
