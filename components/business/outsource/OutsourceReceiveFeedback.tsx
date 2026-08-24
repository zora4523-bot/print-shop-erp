import type { OutsourceMutationResult } from '@/actions/outsource.types';

export function OutsourceReceiveFeedback({
  state,
}: {
  state: OutsourceMutationResult | null;
}) {
  if (state?.status === 'success' && state.notice) {
    return <p className="text-xs text-warning-foreground">{state.notice}</p>;
  }
  if (state?.status === 'error') {
    return <p className="text-xs text-destructive">{state.message}</p>;
  }
  if (state?.status === 'invalid') {
    return (
      <ul className="text-xs text-destructive">
        {Object.entries(state.fieldErrors).flatMap(([field, msgs]) =>
          msgs.map((message) => (
            <li key={`${field}-${message}`}>
              {field}: {message}
            </li>
          )),
        )}
      </ul>
    );
  }
  return null;
}
