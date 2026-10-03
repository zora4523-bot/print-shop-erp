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

export function setRouterTransitionListener(next: TransitionListener | null): void {
  listener = next;
}
