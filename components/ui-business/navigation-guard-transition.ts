/**
 * Dependency-free bridge from `instrumentation-client.ts` (Next's public
 * onRouterTransitionStart hook) to the navigation guard. Kept separate so the
 * pre-hydration client entry does not pull in React modules.
 */
type TransitionListener = (url: string) => void;
let listener: TransitionListener | null = null;

export function noteRouterTransitionStart(url: string): void {
  listener?.(url);
}

/** Install a listener for the duration of a confirmed navigation; returns the previous one to restore. */
export function setRouterTransitionListener(next: TransitionListener | null): TransitionListener | null {
  const previous = listener;
  listener = next;
  return previous;
}
