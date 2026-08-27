import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { getHorizontalScrollCueState } from "@/components/ui/use-horizontal-scroll-cue"

describe("horizontal table scroll cue", () => {
  it("never draws an unconditional table-edge shadow", () => {
    const globalsCss = readFileSync(join(process.cwd(), "app/globals.css"), "utf8")

    expect(globalsCss).not.toMatch(/\.admin-horizontal-scroll-cue\s*\{/)
    expect(globalsCss).toContain(
      ".admin-horizontal-scroll-cue[data-scroll-cue-left]"
    )
    expect(globalsCss).toContain(
      ".admin-horizontal-scroll-cue[data-scroll-cue-right]"
    )
  })

  it("shows no cue when the table fits its container", () => {
    expect(
      getHorizontalScrollCueState({
        clientWidth: 908,
        scrollLeft: 0,
        scrollWidth: 908,
      })
    ).toEqual({ left: false, right: false })
  })

  it("shows only the direction that still contains hidden columns", () => {
    const dimensions = { clientWidth: 600, scrollWidth: 900 }

    expect(
      getHorizontalScrollCueState({ ...dimensions, scrollLeft: 0 })
    ).toEqual({ left: false, right: true })
    expect(
      getHorizontalScrollCueState({ ...dimensions, scrollLeft: 150 })
    ).toEqual({ left: true, right: true })
    expect(
      getHorizontalScrollCueState({ ...dimensions, scrollLeft: 300 })
    ).toEqual({ left: true, right: false })
  })

  it("ignores subpixel layout differences at either edge", () => {
    expect(
      getHorizontalScrollCueState({
        clientWidth: 600,
        scrollLeft: 0.5,
        scrollWidth: 900,
      })
    ).toEqual({ left: false, right: true })
    expect(
      getHorizontalScrollCueState({
        clientWidth: 600,
        scrollLeft: 299.5,
        scrollWidth: 900,
      })
    ).toEqual({ left: true, right: false })
  })
})
