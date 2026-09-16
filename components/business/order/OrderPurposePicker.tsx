'use client';
import { useId } from 'react';
import { PillPicker } from './order-form-b/OrderFieldPrimitives';

export function OrderPurposePicker({ value, disabled, onChange }: {
  value: string; disabled: boolean; onChange: (value: string) => void;
}) {
  const uid = useId();
  return <PillPicker<string> id={`${uid}-purpose`} label="工单类型" value={value} disabled={disabled}
    options={[
      { value: 'STOCK_BLANK', label: '局部烫金' },
      { value: 'CUSTOM_SINGLE_FLAT_FOIL', label: '专版烫金' },
      { value: 'COLOR_PRINT', label: '彩印' },
      { value: 'SAMPLE_SHIPMENT', label: '寄样品' },
      { value: 'PROOF', label: '打样' },
    ]} onChange={onChange} />;
}
