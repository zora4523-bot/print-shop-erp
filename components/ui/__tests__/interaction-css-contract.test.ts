import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const eslintConfigSource = readFileSync(join(root, "eslint.config.mjs"), "utf8")
const globalsCss = readFileSync(join(root, "app/globals.css"), "utf8")
const dropdownSource = readFileSync(
  join(root, "components/ui/dropdown-menu.tsx"),
  "utf8"
)
const sheetSource = readFileSync(
  join(root, "components/ui/sheet.tsx"),
  "utf8"
)

function productionTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "__tests__") return []
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return productionTsxFiles(path)
    return entry.isFile() && entry.name.endsWith(".tsx") ? [path] : []
  })
}

describe("shared interaction CSS contract", () => {
  it("does not shrink disabled controls inside a 44px shell target", () => {
    const targetRule = globalsCss.slice(
      globalsCss.indexOf(".admin-viewport :where(a[href], button"),
      globalsCss.indexOf("@media (prefers-reduced-motion: reduce)")
    )

    expect(targetRule).toContain("min-height: 2.75rem")
    expect(targetRule).toContain(".worker-viewport :where")
    expect(targetRule).toContain(':not([aria-hidden="true"])')
    expect(targetRule).toContain('[role="checkbox"]')
    expect(targetRule).not.toContain("button:not([disabled])")
    expect(targetRule).not.toContain(":not([aria-disabled=\"true\"])")
    expect(globalsCss).toContain(
      ":where(.admin-viewport, .worker-viewport, .touch-viewport)"
    )
  })

  it("measures the visible Base UI checkbox target instead of its hidden input", () => {
    const viewportGate = readFileSync(
      join(root, "tests/visual/ui-gates.ts"),
      "utf8"
    )

    expect(viewportGate).toContain('input:not([type="hidden"]):not([aria-hidden="true"])')
    expect(viewportGate).toContain('[role="checkbox"]:not([aria-disabled="true"])')
  })

  it("keeps the native checkbox guard in eslint", () => {
    expect(eslintConfigSource).toContain("NATIVE_CHECKBOX_GUARD_MESSAGE")
    expect(eslintConfigSource).toContain(
      "Use the shared Checkbox component so the 44px target, 20px indicator, keyboard states, and mixed-state semantics stay consistent."
    )
    expect(eslintConfigSource).toContain(
      "JSXOpeningElement[name.name='input'] > JSXAttribute[name.name='type'][value.value='checkbox']"
    )
  })

  it("reduces motion for primitives mounted outside the app shells", () => {
    for (const slot of [
      "dialog-content",
      "alert-dialog-content",
      "sheet-content",
      "dropdown-menu-content",
      "tooltip-content",
    ]) {
      expect(globalsCss).toContain(`[data-slot="${slot}"]`)
    }
  })

  it("reduces motion inside every app shell, including generated content", () => {
    const reducedMotionRule = globalsCss.slice(
      globalsCss.indexOf("@media (prefers-reduced-motion: reduce)"),
      globalsCss.indexOf("[data-slot=\"dialog-content\"]")
    )

    for (const shell of ["admin", "worker", "touch"]) {
      expect(reducedMotionRule).toContain(`.${shell}-viewport *`)
      expect(reducedMotionRule).toContain(`.${shell}-viewport *::before`)
      expect(reducedMotionRule).toContain(`.${shell}-viewport *::after`)
    }
    expect(reducedMotionRule).toContain("scroll-behavior: auto !important")
    expect(reducedMotionRule).toContain("animation-duration: 0.01ms !important")
    expect(reducedMotionRule).toContain("animation-iteration-count: 1 !important")
    expect(reducedMotionRule).toContain("transition-duration: 0.01ms !important")
  })

  it("gives every interactive menu item a 44px target and focus ring", () => {
    expect(dropdownSource.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(5)
    expect(dropdownSource.match(/focus-visible:ring-3/g)?.length).toBeGreaterThanOrEqual(5)
    expect(dropdownSource.match(/focus-visible:ring-ring/g)?.length).toBeGreaterThanOrEqual(5)
  })

  it("keeps portal-mounted sheet controls inside the shared touch contract", () => {
    expect(sheetSource).toContain(
      '"touch-viewport fixed z-50 flex flex-col'
    )
  })

  it("routes production disclosures through the shared primitive", () => {
    const nativeSummaryConsumers = [
      ...productionTsxFiles(join(root, "app")),
      ...productionTsxFiles(join(root, "components")),
    ].filter(
      (path) =>
        !path.endsWith("components/ui/disclosure.tsx") &&
        readFileSync(path, "utf8").includes("<summary")
    )

    expect(nativeSummaryConsumers).toEqual([])
  })
})
