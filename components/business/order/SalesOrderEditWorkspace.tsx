'use client';

import { useState, type ReactNode } from 'react';
import { OrderEditorAuxiliaryContext, useOrderEditorAuxiliaryController } from './use-order-editor-auxiliary';

/** Keep independently saved address changes from discarding unsaved metadata. */
export function SalesOrderEditWorkspace({ children, addAddress }: { children: ReactNode; addAddress: ReactNode }) {
  const [dirty, setDirty] = useState(false);
  const auxiliary = useOrderEditorAuxiliaryController(dirty);
  return <OrderEditorAuxiliaryContext.Provider value={auxiliary.context}>
    <fieldset disabled={auxiliary.dirty || auxiliary.pending} className="min-w-0" onChangeCapture={() => setDirty(true)}>
      {children}
    </fieldset>
    {addAddress && dirty ? <p className="text-sm text-muted-foreground">请先保存当前修改，再添加地址。</p> : null}
    {addAddress}
  </OrderEditorAuxiliaryContext.Provider>;
}
