'use client';
import type { ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import type { OrderPackagingMode } from '@/generated/prisma/enums';
import type { OrderPackagingSelection } from '@/lib/order/create-packaging-selection';
import {
  isMixedPackaging,
  packagingBoxType,
  packagingCapacity,
  packagingModeLabel,
  packagingType,
  PACKAGING_BOXES,
  type PackagingBoxType,
  type PackagingType,
} from '@/lib/order/packaging-mode';
import { FieldError, Group, PillPicker } from './OrderFieldPrimitives';

type OrderPackagingRowView = {
  /** 例：设计款 1 · 大号封 */
  label: string;
  quantity: number;
  mode: OrderPackagingMode;
  unitsPerBag: number;
  /** 所在包装组的包/盒数；不包装为 0，组成不完整时为 null。 */
  bagCount: number | null;
  error?: string | null;
};

export type OrderPackagingView = {
  /** 与工单规格明细一一对应。 */
  rows: readonly OrderPackagingRowView[];
  selection: OrderPackagingSelection;
  summary: string;
};

type RowChoice = 'BAG' | 'BOX_RED_CARD' | 'BOX_TACTILE' | 'UNPACKED';

const ROW_CHOICES: readonly { value: RowChoice; label: string }[] = [
  { value: 'BAG', label: '入袋' },
  { value: 'BOX_RED_CARD', label: PACKAGING_BOXES.RED_CARD.label },
  { value: 'BOX_TACTILE', label: PACKAGING_BOXES.TACTILE.label },
  { value: 'UNPACKED', label: '不包装' },
];

function rowChoice(mode: OrderPackagingMode): RowChoice {
  const box = packagingBoxType(mode);
  if (box) return box === 'TACTILE' ? 'BOX_TACTILE' : 'BOX_RED_CARD';
  return packagingType(mode) === 'UNPACKED' ? 'UNPACKED' : 'BAG';
}

function choiceType(choice: RowChoice): [PackagingType, PackagingBoxType] {
  if (choice === 'BOX_TACTILE') return ['BOX', 'TACTILE'];
  if (choice === 'BOX_RED_CARD') return ['BOX', 'RED_CARD'];
  return [choice === 'UNPACKED' ? 'UNPACKED' : 'BAG', 'RED_CARD'];
}

// Wide containers read as a table; narrow ones stack each cell with its own label.
const ROW_GRID = '@min-[640px]:grid-cols-[minmax(0,1fr)_5.5rem_11rem_9rem]';
// Narrow containers show a caption per cell; wide ones rely on the header row. The
// accessible label stays a plain sr-only <label> (the clipping gate exempts only that).
const CELL_CAPTION = 'mb-1.5 block text-xs font-bold tracking-widest text-muted-foreground @min-[640px]:hidden';

function CellLabel({ htmlFor, children }: { htmlFor: string; children: string }) {
  return (
    <>
      <span aria-hidden="true" className={CELL_CAPTION}>{children}</span>
      <label htmlFor={htmlFor} className="sr-only">{children}</label>
    </>
  );
}

/**
 * 整单包装（DECISIONS 2026-09-23）：放在设计款标签之外，顶部设置作用于全部规格，
 * 每个规格一行填写每包数量；常规装下单个规格可单独改类型。
 */
export function OrderPackagingSection({
  uid,
  packaging,
  grouped,
  disabled = false,
  priceEditors,
  notes,
  onTypeChange,
  onMixingChange,
  onUnitsPerBagChange,
}: {
  uid: string;
  packaging: OrderPackagingView;
  grouped: boolean;
  disabled?: boolean;
  priceEditors?: ReactNode;
  notes?: ReactNode;
  onTypeChange: (type: PackagingType, box: PackagingBoxType, itemIndex?: number) => void;
  onMixingChange: (mixed: boolean) => void;
  onUnitsPerBagChange: (itemIndex: number, value: number) => void;
}) {
  const { rows, selection } = packaging;
  const specNoun = grouped ? '规格' : '款';
  const mixingNote = rows.length < 2
    ? grouped ? '混装需至少 2 个规格明细' : '混装需至少 2 款'
    : selection.mixing === null
      ? `部分${specNoun}已混装；选「混装」会把全部${specNoun}并入同一混装组。`
      : selection.mixing === 'SINGLE_STYLE' && grouped ? '混装范围：本工单全部规格' : null;

  return (
    <Group title="包装" appearance={grouped ? 'plain' : 'divided'} description={packaging.summary}>
      <div className="space-y-4">
        <PillPicker<PackagingType | ''>
          id={`${uid}-packaging-type`}
          label="包装类型"
          value={selection.type ?? ''}
          options={[
            { value: 'BAG', label: '入袋' },
            { value: 'UNPACKED', label: '不包装' },
            { value: 'BOX', label: '装盒' },
          ]}
          disabled={disabled}
          onChange={(type) => {
            if (type) onTypeChange(type, selection.box ?? 'RED_CARD');
          }}
        />
        {selection.type === 'BOX' ? (
          <PillPicker<PackagingBoxType | ''>
            id={`${uid}-box-type`}
            label="盒子"
            value={selection.box ?? ''}
            options={Object.entries(PACKAGING_BOXES).map(([value, box]) => ({
              value: value as PackagingBoxType,
              label: `${box.label} · 最多 ${box.capacity} 个/盒`,
            }))}
            disabled={disabled}
            onChange={(box) => {
              if (box) onTypeChange('BOX', box);
            }}
          />
        ) : null}
        {selection.type === null ? (
          <p className="text-xs text-muted-foreground">
            各{specNoun}包装类型不同；点选上方类型会统一应用到全部{specNoun}。
          </p>
        ) : null}
        {selection.type !== 'UNPACKED' ? (
          <div>
            <PillPicker<OrderPackagingMode | ''>
              id={`${uid}-packaging-mode`}
              label="包装方式"
              value={selection.mixing ?? ''}
              options={[
                { value: 'SINGLE_STYLE', label: '常规装' },
                { value: 'MIXED_STYLE', label: '混装', disabled: rows.length < 2 },
              ]}
              disabled={disabled}
              onChange={(mode) => {
                if (mode) onMixingChange(mode === 'MIXED_STYLE');
              }}
            />
            {mixingNote ? <p className="mt-2 text-xs text-muted-foreground">{mixingNote}</p> : null}
          </div>
        ) : null}
      </div>

      <div data-slot="order-packaging-rows" className="mt-5 min-w-0">
        <div
          aria-hidden="true"
          className={`hidden gap-3 border-b pb-2 text-xs font-bold text-muted-foreground @min-[640px]:grid ${ROW_GRID}`}
        >
          <span>{grouped ? '规格' : '款式'}</span>
          <span className="text-right">数量</span>
          <span>包装类型</span>
          <span>每包 / 每盒数量</span>
        </div>
        <ul className="divide-y">
          {rows.map((row, index) => (
            <PackagingRow
              key={index}
              uid={uid}
              index={index}
              row={row}
              disabled={disabled}
              onTypeChange={onTypeChange}
              onUnitsPerBagChange={onUnitsPerBagChange}
            />
          ))}
        </ul>
      </div>

      {priceEditors ? <div className="mt-5 space-y-3">{priceEditors}</div> : null}
      {notes ? <div className="mt-5">{notes}</div> : null}
    </Group>
  );
}

function PackagingRow({
  uid,
  index,
  row,
  disabled,
  onTypeChange,
  onUnitsPerBagChange,
}: {
  uid: string;
  index: number;
  row: OrderPackagingRowView;
  disabled: boolean;
  onTypeChange: (type: PackagingType, box: PackagingBoxType, itemIndex?: number) => void;
  onUnitsPerBagChange: (itemIndex: number, value: number) => void;
}) {
  const prefix = `${uid}-${index}`;
  const mixed = isMixedPackaging(row.mode);
  const box = packagingBoxType(row.mode) !== null;
  const unpacked = packagingType(row.mode) === 'UNPACKED';
  const quantity = `${row.quantity.toLocaleString('zh-CN')} 个`;
  return (
    <li className={`grid grid-cols-1 gap-3 py-3 @min-[640px]:items-start ${ROW_GRID}`}>
      <p id={`${prefix}-packaging-row`} className="min-w-0 text-sm font-semibold @min-[640px]:pt-2.5">
        {row.label}
        <span className="font-normal text-muted-foreground @min-[640px]:hidden"> · {quantity}</span>
      </p>
      <p className="hidden text-right text-sm tabular-nums @min-[640px]:block @min-[640px]:pt-2.5">{quantity}</p>
      <div className="min-w-0">
        {mixed ? (
          <p className="text-sm @min-[640px]:pt-2.5">{packagingModeLabel(row.mode)}</p>
        ) : (
          <>
            <CellLabel htmlFor={`${prefix}-packaging-choice`}>包装类型</CellLabel>
            <NativeSelect
              id={`${prefix}-packaging-choice`}
              value={rowChoice(row.mode)}
              disabled={disabled}
              aria-describedby={`${prefix}-packaging-row`}
              onChange={(event) => {
                const [type, boxType] = choiceType(event.target.value as RowChoice);
                onTypeChange(type, boxType, index);
              }}
            >
              {ROW_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>{choice.label}</option>
              ))}
            </NativeSelect>
          </>
        )}
      </div>
      <div className="min-w-0">
        {unpacked ? (
          <p className="text-sm text-muted-foreground @min-[640px]:pt-2.5">包装费 ¥0.00</p>
        ) : (
          <>
            <CellLabel htmlFor={`${prefix}-units-per-bag`}>{box ? '每盒数量' : '每包数量'}</CellLabel>
            <Input
              id={`${prefix}-units-per-bag`}
              type="number"
              min={1}
              max={packagingCapacity(row.mode) ?? undefined}
              step={1}
              required
              aria-required="true"
              aria-invalid={Boolean(row.error)}
              aria-describedby={`${prefix}-packaging-row ${prefix}-packaging-message`}
              disabled={disabled}
              value={row.unitsPerBag || ''}
              className="h-10"
              onChange={(event) => onUnitsPerBagChange(index, Number(event.target.value) || 0)}
            />
            <FieldError
              id={`${prefix}-packaging-message`}
              reservedLines={2}
              hint={
                row.bagCount !== null
                  ? `共 ${row.bagCount.toLocaleString('zh-CN')} ${box ? '盒' : '包'}${mixed ? '（混装组）' : ''}`
                  : undefined
              }
            >
              {row.error ?? undefined}
            </FieldError>
          </>
        )}
      </div>
    </li>
  );
}
