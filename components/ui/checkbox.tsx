"use client"

import type { KeyboardEvent } from "react"
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import type { BaseUIEvent } from "@base-ui/react/types"
import { CheckIcon, MinusIcon } from "lucide-react"

import { cn } from "@/lib/utils"

type CheckboxProps = Omit<CheckboxPrimitive.Root.Props, "children">
type BaseUICheckboxKeyEvent = BaseUIEvent<KeyboardEvent<HTMLSpanElement>>

function Checkbox({
  className,
  indeterminate = false,
  onKeyDown,
  ...props
}: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      indeterminate={indeterminate}
      className={cn(
        "inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:focus-visible:ring-destructive data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      onKeyDown={(event: BaseUICheckboxKeyEvent) => {
        onKeyDown?.(event)
        if (event.key === "Enter") {
          event.preventBaseUIHandler?.()
        }
      }}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        keepMounted
        data-slot="checkbox-indicator"
        className="pointer-events-none flex size-5 items-center justify-center rounded-[0.375rem] border border-input bg-background text-transparent shadow-xs transition-[background-color,border-color,color,box-shadow] motion-reduce:transition-none data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground data-indeterminate:border-primary data-indeterminate:bg-primary data-indeterminate:text-primary-foreground dark:bg-input/30 dark:data-checked:bg-primary dark:data-indeterminate:bg-primary"
      >
        <CheckIcon
          aria-hidden="true"
          className="size-3.5 in-data-[indeterminate]:hidden"
        />
        <MinusIcon
          aria-hidden="true"
          className="hidden size-3.5 in-data-[indeterminate]:block"
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
export type { CheckboxProps }
