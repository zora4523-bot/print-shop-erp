import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonStyles = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[box-shadow,transform] outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // `in-data-[emphasis=inverse]`：工单详情「当前待办」列把主操作压成深色、
        // 破坏性操作提为品牌红实心。以前这层是 CSS Module 里反转 `--primary`，
        // 同一 token 在同页有两个值；现在由 Button 自己按作用域声明。
        default:
          "bg-primary text-primary-foreground [a]:hover:bg-primary/80 in-data-[emphasis=inverse]:not-disabled:border-foreground in-data-[emphasis=inverse]:not-disabled:bg-foreground in-data-[emphasis=inverse]:not-disabled:text-background",
        outline:
          "border-border bg-background text-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        // 悬停只加描边、不加深底：暗色下 /30 底会把红字对比压到 4.27:1（< 4.5）。
        destructive:
          "bg-destructive/10 text-destructive hover:border-destructive/50 focus-visible:border-destructive focus-visible:ring-destructive dark:bg-destructive/20 in-data-[emphasis=inverse]:not-disabled:border-primary in-data-[emphasis=inverse]:not-disabled:bg-primary in-data-[emphasis=inverse]:not-disabled:text-primary-foreground",
        // 标准选中态（分段按钮 / 筛选 / 标签页共用）：品牌色描边 + 10% 底 + 加粗，
        // 悬停不变色——选中项不是「可再点一次」的目标。
        selected:
          "border-primary bg-primary/10 font-semibold text-primary hover:border-primary hover:bg-primary/10 hover:text-primary dark:bg-primary/15 dark:hover:bg-primary/15",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

// Links consume this helper directly; resolve variant/base conflicts here too.
const buttonVariants: typeof buttonStyles = (props) => cn(buttonStyles(props))

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
