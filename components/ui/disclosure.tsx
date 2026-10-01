import * as React from "react"
import { ChevronDown } from "lucide-react"

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

/**
 * 折叠摘要末尾的方向箭头与「展开 / 收起」文字（UI 规范：折叠摘要必须明确显示状态）。
 * 只跟随包住自己的那个 `<details>`：选择器是 `details[open] > summary 内的自己`，
 * 外层分区展开不会让内层摘要误显示「收起」（不用 `group-open`，它匹配任意祖先）。
 */
function DisclosureIndicator({ className }: { className?: string }) {
  return (
    <span
      data-slot="disclosure-indicator"
      aria-hidden="true"
      className={cn(
        "ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-normal text-muted-foreground",
        className
      )}
    >
      <ChevronDown className="size-4 transition-transform motion-reduce:transition-none [details[open]>summary_&]:rotate-180" />
      <span className="[details[open]>summary_&]:hidden">展开</span>
      <span className="hidden [details[open]>summary_&]:inline">收起</span>
    </span>
  )
}

export { Disclosure, DisclosureIndicator, DisclosureSummary }
