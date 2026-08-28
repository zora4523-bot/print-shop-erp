"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { useHorizontalScrollCue } from "@/components/ui/use-horizontal-scroll-cue"

// 注意：外层这个可键盘聚焦的滚动容器（role=region + aria-label +
// tabIndex）是本地相对 shadcn 原版加的，responsive-tables 门禁依赖它。
// `shadcn add table --overwrite` 会静默抹掉——见 CLAUDE.md §15.6 旁的
// registry 漂移清单。
//
// label 可传：此前 aria-label 硬编码成「数据表格」，同一页渲染多张表时
// （如 /owner/rules/internal-pricing 的价格阶梯 + 加价规则）会出现多个同名地标，读屏器
// 的地标列表里根本分不出谁是谁。默认值保留原文案，避免一次性改崩。
function Table({
  className,
  label = "数据表格",
  ...props
}: React.ComponentProps<"table"> & { label?: string }) {
  const scrollRef = useHorizontalScrollCue<HTMLDivElement>()

  return (
    <div
      ref={scrollRef}
      data-slot="table-container"
      role="region"
      aria-label={label}
      tabIndex={0}
      className="admin-horizontal-scroll-cue relative w-full overflow-x-auto overscroll-x-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
