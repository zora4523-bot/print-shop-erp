"use client"

import * as React from "react"

const SCROLL_EDGE_TOLERANCE_PX = 1

type HorizontalScrollMetrics = {
  clientWidth: number
  scrollLeft: number
  scrollWidth: number
}

export type HorizontalScrollCueState = {
  left: boolean
  right: boolean
}

export function getHorizontalScrollCueState({
  clientWidth,
  scrollLeft,
  scrollWidth,
}: HorizontalScrollMetrics): HorizontalScrollCueState {
  const maxScrollLeft = Math.max(0, scrollWidth - clientWidth)

  if (maxScrollLeft <= SCROLL_EDGE_TOLERANCE_PX) {
    return { left: false, right: false }
  }

  return {
    left: scrollLeft > SCROLL_EDGE_TOLERANCE_PX,
    right: scrollLeft < maxScrollLeft - SCROLL_EDGE_TOLERANCE_PX,
  }
}

function updateHorizontalScrollCue(element: HTMLElement) {
  const state = getHorizontalScrollCueState(element)

  element.toggleAttribute("data-scroll-cue-left", state.left)
  element.toggleAttribute("data-scroll-cue-right", state.right)
}

export function useHorizontalScrollCue<T extends HTMLElement>() {
  const ref = React.useRef<T>(null)

  React.useEffect(() => {
    const element = ref.current
    if (!element) return

    const update = () => updateHorizontalScrollCue(element)
    const resizeObserver = new ResizeObserver(update)
    const observeSizes = () => {
      resizeObserver.disconnect()
      resizeObserver.observe(element)
      for (const child of element.children) {
        resizeObserver.observe(child)
      }
    }
    const mutationObserver = new MutationObserver(() => {
      observeSizes()
      update()
    })

    update()
    observeSizes()
    element.addEventListener("scroll", update, { passive: true })
    mutationObserver.observe(element, {
      childList: true,
      subtree: true,
    })

    return () => {
      element.removeEventListener("scroll", update)
      mutationObserver.disconnect()
      resizeObserver.disconnect()
    }
  }, [])

  return ref
}
