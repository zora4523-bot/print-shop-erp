import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Native details/summary semantics with the shared touch-target and keyboard
 * focus contract. Keep the browser's disclosure behavior instead of replacing
 * it with a JavaScript-only button.
 */
function Disclosure({
  className,
  ...props
}: React.ComponentProps<"details">) {
  return (
    <details
      data-slot="disclosure"
      className={cn("group", className)}
      {...props}
    />
  )
}

function DisclosureSummary({
  className,
  ...props
}: React.ComponentProps<"summary">) {
  return (
    <summary
      data-slot="disclosure-summary"
      className={cn(
        "flex min-h-11 w-full cursor-pointer list-none items-center rounded-md text-sm font-medium text-foreground outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&::-webkit-details-marker]:hidden",
        className
      )}
      {...props}
    />
  )
}

export { Disclosure, DisclosureSummary }
