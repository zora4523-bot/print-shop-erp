import * as React from "react"

import { cn } from "@/lib/utils"
import { FIELD_BASE_CLASS, FIELD_READONLY_CLASS } from "./field-styles"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        FIELD_BASE_CLASS,
        FIELD_READONLY_CLASS,
        "min-h-20 resize-y py-2",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
