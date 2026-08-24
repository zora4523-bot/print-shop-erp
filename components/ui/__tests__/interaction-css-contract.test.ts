import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
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
    expect(targetRule).not.toContain("button:not([disabled])")
    expect(targetRule).not.toContain(":not([aria-disabled=\"true\"])")
    expect(globalsCss).toContain(
      ":where(.admin-viewport, .worker-viewport, .touch-viewport)"
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
