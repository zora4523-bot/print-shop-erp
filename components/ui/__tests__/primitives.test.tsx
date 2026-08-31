import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Disclosure,
  DisclosureSummary,
} from "@/components/ui/disclosure"

describe("Button interaction contract", () => {
  it("keeps the same size identity and strong focus style when disabled", () => {
    const html = renderToStaticMarkup(
      <>
        <Button>保存</Button>
        <Button disabled>正在保存…</Button>
      </>
    )

    expect(html.match(/data-size="default"/g)).toHaveLength(2)
    expect(html.match(/focus-visible:ring-ring/g)).toHaveLength(2)
    expect(html).not.toContain("focus-visible:ring-ring/50")
  })

  it("does not dilute the destructive focus indicator", () => {
    const html = renderToStaticMarkup(
      <Button variant="destructive">删除</Button>
    )

    expect(html).toContain("focus-visible:ring-destructive")
    expect(html).not.toContain("focus-visible:ring-destructive/")
  })
})

describe("Checkbox interaction contract", () => {
  it("separates the 44px target from the compact visual indicator", () => {
    const html = renderToStaticMarkup(
      <Checkbox aria-label="急单" defaultChecked name="isUrgent" />
    )

    expect(html).toContain('data-slot="checkbox"')
    expect(html).toContain('role="checkbox"')
    expect(html).toContain("size-11")
    expect(html).toContain('data-slot="checkbox-indicator"')
    expect(html).toContain("size-5")
    expect(html).toContain("motion-reduce:transition-none")
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('name="isUrgent"')
  })

  it("preserves disabled and mixed-state semantics", () => {
    const html = renderToStaticMarkup(
      <Checkbox aria-label="选择全部" disabled indeterminate />
    )

    expect(html).toContain('aria-checked="mixed"')
    expect(html).toContain('data-disabled=""')
    expect(html).toContain('data-indeterminate=""')
  })
})

describe("Disclosure", () => {
  it("keeps native semantics with a 44px target and visible keyboard focus", () => {
    const html = renderToStaticMarkup(
      <Disclosure>
        <DisclosureSummary>高级设置</DisclosureSummary>
        <p>内容</p>
      </Disclosure>
    )

    expect(html).toContain("<details")
    expect(html).toContain("<summary")
    expect(html).toContain('data-slot="disclosure-summary"')
    expect(html).toContain("min-h-11")
    expect(html).toContain("focus-visible:ring-3")
    expect(html).toContain("focus-visible:ring-ring")
  })
})

describe("Card", () => {
  it("exposes stable composition slots without imposing a heading level", () => {
    const html = renderToStaticMarkup(
      <Card>
        <CardHeader>
          <CardTitle>订单摘要</CardTitle>
          <CardDescription>最近 30 天</CardDescription>
          <CardAction>更多</CardAction>
        </CardHeader>
        <CardContent>内容</CardContent>
        <CardFooter>操作</CardFooter>
      </Card>
    )

    expect(html).toContain('data-slot="card"')
    expect(html).toContain('data-slot="card-action"')
    expect(html).toContain('<div data-slot="card-title"')
    expect(html).toContain('bg-card')
  })
})

describe("Alert", () => {
  it.each([
    ["warning", "border-warning/40", "text-warning-foreground"],
    ["success", "border-success/40", "text-success-foreground"],
    ["info", "border-info/40", "text-info-foreground"],
    ["destructive", "border-destructive/40", "text-destructive"],
  ] as const)("uses semantic tokens for %s feedback", (variant, border, text) => {
    const html = renderToStaticMarkup(
      <Alert variant={variant}>
        <AlertTitle>状态</AlertTitle>
        <AlertDescription>请检查详情</AlertDescription>
      </Alert>
    )

    expect(html).toContain('role="alert"')
    expect(html).toContain(border)
    expect(html).toContain(text)
    expect(html).toContain('data-slot="alert-description"')
  })

  it("allows non-live static guidance to override the default role", () => {
    const html = renderToStaticMarkup(<Alert role="note">辅助说明</Alert>)

    expect(html).toContain('role="note"')
  })
})

describe("Textarea", () => {
  it("forwards validation, disabled, and labelling attributes", () => {
    const html = renderToStaticMarkup(
      <Textarea
        aria-describedby="reason-error"
        aria-invalid="true"
        disabled
        name="reason"
      />
    )

    expect(html).toContain('data-slot="textarea"')
    expect(html).toContain('aria-describedby="reason-error"')
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('disabled=""')
    expect(html).toContain('focus-visible:ring-3')
  })
})

describe("Dialog composition", () => {
  it("keeps trigger semantics in the Base UI focus-management root", () => {
    const html = renderToStaticMarkup(
      <Dialog>
        <DialogTrigger>编辑</DialogTrigger>
      </Dialog>
    )

    expect(html).toContain('data-slot="dialog-trigger"')
    expect(html).toContain('<button')
    expect(html).toContain('aria-haspopup="dialog"')
  })

  it("provides responsive header and footer layout slots", () => {
    const html = renderToStaticMarkup(
      <>
        <DialogHeader>标题区</DialogHeader>
        <DialogFooter>操作区</DialogFooter>
      </>
    )

    expect(html).toContain('data-slot="dialog-header"')
    expect(html).toContain('data-slot="dialog-footer"')
    expect(html).toContain('flex-col-reverse')
  })
})

describe("AlertDialog composition", () => {
  it("uses Base UI alert-dialog trigger semantics", () => {
    const html = renderToStaticMarkup(
      <AlertDialog>
        <AlertDialogTrigger>删除</AlertDialogTrigger>
      </AlertDialog>
    )

    expect(html).toContain('data-slot="alert-dialog-trigger"')
    expect(html).toContain('<button')
    expect(html).toContain('aria-haspopup="dialog"')
  })

  it("keeps explicit decision actions in a responsive footer", () => {
    const html = renderToStaticMarkup(
      <>
        <AlertDialogHeader>影响范围</AlertDialogHeader>
        <AlertDialogFooter>取消或确认</AlertDialogFooter>
      </>
    )

    expect(html).toContain('data-slot="alert-dialog-header"')
    expect(html).toContain('data-slot="alert-dialog-footer"')
    expect(html).toContain('sm:justify-end')
  })
})

describe("Progress", () => {
  it("exposes an accessible determinate value and lets Base UI size the bar", () => {
    const html = renderToStaticMarkup(
      <Progress aria-label="导出进度" value={42} />
    )

    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-label="导出进度"')
    expect(html).toContain('aria-valuenow="42"')
    expect(html).toContain('data-slot="progress-track"')
    expect(html).toContain('data-slot="progress-indicator"')
    expect(html).toContain('width:42%')
  })

  it("preserves Base UI indeterminate semantics", () => {
    const html = renderToStaticMarkup(
      <Progress aria-label="正在处理" value={null} />
    )

    expect(html).toContain('data-indeterminate=""')
    expect(html).not.toContain('aria-valuenow=')
    expect(html).toContain('motion-reduce:animate-none')
  })
})
