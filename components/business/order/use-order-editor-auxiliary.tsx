'use client';

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';

type AuxiliaryState = { dirty: boolean; pending: boolean };
type AuxiliaryContext = {
  entries: Readonly<Record<string, AuxiliaryState>>;
  mainBlocked: boolean;
  register: (id: string, state: AuxiliaryState | null) => void;
};

export const OrderEditorAuxiliaryContext =
  createContext<AuxiliaryContext | null>(null);

/** Coordinates independently saved fee forms only inside the administrator editor. */
export function useOrderEditorAuxiliaryController(mainBlocked: boolean) {
  const [entries, setEntries] = useState<Record<string, AuxiliaryState>>({});
  const register = useCallback((id: string, state: AuxiliaryState | null) => {
    setEntries((current) => {
      const previous = current[id];
      if (!state) {
        if (!previous) return current;
        const next = { ...current };
        delete next[id];
        return next;
      }
      if (previous?.dirty === state.dirty && previous.pending === state.pending)
        return current;
      return { ...current, [id]: state };
    });
  }, []);
  const context = useMemo(
    () => ({ entries, mainBlocked, register }),
    [entries, mainBlocked, register],
  );
  return {
    context,
    dirty: Object.values(entries).some((entry) => entry.dirty),
    pending: Object.values(entries).some((entry) => entry.pending),
  };
}

export function useOrderEditorAuxiliary(state: AuxiliaryState) {
  const context = useContext(OrderEditorAuxiliaryContext);
  const id = useId();
  const register = context?.register;
  useLayoutEffect(() => {
    register?.(id, { dirty: state.dirty, pending: state.pending });
  }, [register, id, state.dirty, state.pending]);
  useLayoutEffect(() => () => register?.(id, null), [register, id]);
  const other = Object.entries(context?.entries ?? {}).filter(
    ([key]) => key !== id,
  );
  return {
    managed: context !== null,
    blocked: Boolean(
      context?.mainBlocked ||
        other.some(([, entry]) => entry.dirty || entry.pending),
    ),
    pending: Object.values(context?.entries ?? {}).some(
      (entry) => entry.pending,
    ),
  };
}
