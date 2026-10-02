'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { ActionNotice } from '@/components/ui-business';

const CompletionFeedback = createContext<((message: string) => void) | null>(null);
export const useCompletionFeedback = () => useContext(CompletionFeedback);

export function WorkerCompletionFeedback({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  return <CompletionFeedback.Provider value={setMessage}>
    {message && <ActionNotice tone="success" title={message} />}
    {children}
  </CompletionFeedback.Provider>;
}
