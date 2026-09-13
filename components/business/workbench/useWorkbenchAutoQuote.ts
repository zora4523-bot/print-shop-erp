'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { quoteWorkbenchItemAction } from '@/actions/workbench';
import type { WorkbenchItemQuoteInput } from '@/lib/workbench/item-quote';
import type { WorkbenchQuoteResult } from '@/lib/workbench/quote';

export function useWorkbenchAutoQuote(
  input: WorkbenchItemQuoteInput | null,
  heading: RefObject<HTMLHeadingElement | null>,
  invalidMessage?: string | null,
) {
  const key = input ? JSON.stringify(input) : null;
  const [result, setResult] = useState<WorkbenchQuoteResult | null>(null);
  const [pending, setPending] = useState(false);
  const generation = useRef(0);
  const [revision, setRevision] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invalidate = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    generation.current += 1;
    setResult(null);
    setPending(false);
    setRevision((value) => value + 1);
  }, []);
  const calculate = useCallback(
    async (manual = false) => {
      if (timer.current) clearTimeout(timer.current);
      if (!key) {
        setResult({
          status: 'error',
          message:
            invalidMessage ?? '请选好产品、规格、纸张和工艺，并填写有效数量',
        });
        return;
      }
      const request = ++generation.current;
      setPending(true);
      setResult(null);
      try {
        const response = await quoteWorkbenchItemAction(
          JSON.parse(key) as WorkbenchItemQuoteInput,
        );
        if (generation.current === request) {
          setResult(response);
          if (manual)
            requestAnimationFrame(() => {
              if (generation.current === request) heading.current?.focus();
            });
        }
      } catch {
        if (generation.current === request)
          setResult({
            status: 'error',
            message: '计算失败，请检查网络后重新计算',
          });
      } finally {
        if (generation.current === request) setPending(false);
      }
    },
    [key, heading, invalidMessage],
  );
  useEffect(() => {
    if (key) timer.current = setTimeout(() => void calculate(), 500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      generation.current += 1;
    };
  }, [key, calculate, revision]);
  return { result, pending, invalidate, calculate };
}
