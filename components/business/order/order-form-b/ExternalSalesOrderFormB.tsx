'use client';

import {
  useId,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEventHandler,
  type DragEventHandler,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  DesignFileType,
  OrderFoilTechnique,
  OrderItemPricingRoute,
  OrderLamination,
  OrderPackagingMode,
} from '@/generated/prisma/enums';
import type { CreateOrderInput } from '@/lib/auth/schemas';
import { cn } from '@/lib/utils';
import type { PendingDesignImage } from '../pending-design-image';
import { formatDesignFileSize } from '../design-file-display';
import { LocalDesignImagePreview } from '../LocalDesignImagePreview';
import { prepareDesignFile } from '../design-upload-client';
import {
  OrderFoilSwatchPicker,
  type OrderFoilSwatchOption,
} from './OrderFoilSwatchPicker';
import {
  OrderPaperSwatchPicker,
  type OrderPaperSwatchOption,
} from './OrderPaperSwatchPicker';

const FOIL_OPTIONS: readonly OrderFoilSwatchOption[] = [
  { value: '亚金', label: '亚金', tone: 'matte-gold' },
  { value: '浅色', label: '浅色', tone: 'light-gold' },
  { value: '红色', label: '红色', tone: 'red' },
  { value: '黑色', label: '黑色', tone: 'black' },
  { value: '银色', label: '银色', tone: 'silver' },
  { value: '蓝色', label: '蓝色', tone: 'blue' },
  { value: '透明色', label: '透明色', tone: 'clear' },
  { value: '绿色', label: '绿色', tone: 'green' },
];

const ROUTE_OPTIONS = [
  { value: OrderItemPricingRoute.STOCK_BLANK, label: '局部烫金' },
  {
    value: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
    label: '专版烫金',
  },
  { value: OrderItemPricingRoute.COLOR_PRINT, label: '彩印' },
] as const;

const LAMINATION_OPTIONS = [
  { value: OrderLamination.MATTE, label: '亚膜' },
  { value: OrderLamination.SOFT_TOUCH, label: '触感膜' },
  { value: OrderLamination.NEW_GLOSS, label: '新光膜' },
  { value: OrderLamination.LASER, label: '雷射' },
] as const;

function StickyOrderFormRail({ rail }: { rail: ReactNode }) {
  return (
    <aside
      data-slot="order-form-rail"
      className="min-w-0 @min-[881px]:sticky @min-[881px]:top-[70px]"
    >
      {rail}
    </aside>
  );
}

export type OrderFormBErrors = {
  summary?: readonly string[];
  customName?: string;
  receiverName?: string;
  receiverPhone?: string;
  receiverAddress?: string;
  packaging?: string;
  items?: readonly (
    | {
        route?: string;
        paper?: string;
        weight?: string;
        specification?: string;
        foilColors?: string;
        quantity?: string;
        designImage?: string;
      }
    | undefined
  )[];
};

export type OrderFormBProps = {
  values: {
    customName: string;
    receiverName: string;
    receiverPhone: string;
    receiverAddress: string;
    isSfCollect: boolean;
  };
  title?: string;
  settlementLabel?: string;
  customNameRequired?: boolean;
  designImageRequired?: boolean;
  receiverNameRequired?: boolean;
  receiverPhoneRequired?: boolean;
  orderExtras?: ReactNode;
  materialExtras?: ReactNode;
  pricingExtras?: ReactNode;
  shippingExtras?: ReactNode;
  afterShipping?: ReactNode;
  allowManualWeight?: boolean;
  allowCustomSize?: boolean;
  items: CreateOrderInput['items'];
  itemFields: readonly { id: string }[];
  activeIndex: number;
  pendingDesigns: Readonly<Record<string, PendingDesignImage[]>>;
  packaging: {
    mode: OrderPackagingMode;
    unitsPerBag: number;
    bagCount: number | null;
    error?: string | null;
  };
  paperOptions: readonly OrderPaperSwatchOption[];
  paperKey: string | null;
  weightOptions: readonly {
    value: number;
    disabled?: boolean;
  }[];
  specificationOptions: readonly {
    value: string;
    label: string;
    disabled?: boolean;
  }[];
  foilOptions?: readonly OrderFoilSwatchOption[];
  disabled?: boolean;
  savedLabel: string;
  fieldErrors?: OrderFormBErrors;
  rail: ReactNode;
  onActiveIndexChange: (index: number) => void;
  onAdd: () => void;
  onDuplicate: (index: number) => void;
  onRemove: (index: number) => void;
  onCustomNameChange: (value: string) => void;
  onRouteChange: (value: OrderItemPricingRoute) => void;
  onPaperChange: (value: string) => void;
  onWeightChange: (value: number) => void;
  onSpecificationChange: (value: string) => void;
  onFoilSidesChange: (front: string[], back: string[]) => void;
  onBackFoilToggle: (enabled: boolean) => void;
  onFoilTechniqueChange: (value: OrderFoilTechnique) => void;
  onCustomSizeChange: (enabled: boolean) => void;
  onPrintFoilModeChange: (value: 'NONE' | 'PARTIAL' | 'FULL') => void;
  onLaminationChange: (value: OrderLamination) => void;
  onQuantityChange: (value: number) => void;
  onPackagingModeChange: (value: OrderPackagingMode) => void;
  onUnitsPerBagChange: (value: number) => void;
  onPendingDesignsChange: (images: PendingDesignImage[]) => void;
  onReceiverAddressChange: (value: string) => void;
  onReceiverAddressPaste?: ClipboardEventHandler<HTMLTextAreaElement>;
  onReceiverNameChange: (value: string) => void;
  onReceiverPhoneChange: (value: string) => void;
  onSfCollectChange: (value: boolean) => void;
};

type PillOption<T extends string | number> = {
  value: T;
  label: string;
  detail?: string;
  disabled?: boolean;
};

function RequiredMark() {
  return (
    <span aria-hidden="true" className="ml-0.5 font-bold text-destructive">
      *
    </span>
  );
}

function FieldLabel({
  htmlFor,
  children,
  required = false,
}: {
  htmlFor?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-2 block text-[0.6875rem] font-bold tracking-[0.16em] text-muted-foreground"
    >
      {children}
      {required ? <RequiredMark /> : null}
    </label>
  );
}

function FieldError({ id, children }: { id?: string; children?: string }) {
  if (!children) return null;
  return (
    <p
      id={id}
      role="alert"
      className="mt-1.5 flex items-start gap-1.5 text-xs font-semibold text-destructive"
    >
      <span
        aria-hidden="true"
        className="mt-px flex size-3.5 shrink-0 items-center justify-center rounded-full bg-destructive text-[0.5625rem] text-destructive-foreground"
      >
        !
      </span>
      <span>{children}</span>
    </p>
  );
}

function PillPicker<T extends string | number>({
  id,
  label,
  value,
  options,
  disabled,
  required,
  note,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: T;
  options: readonly PillOption<T>[];
  disabled?: boolean;
  required?: boolean;
  note?: string;
  error?: string;
  onChange: (value: T) => void;
}) {
  const messageId = `${id}-message`;
  return (
    <fieldset
      className="min-w-0"
      aria-invalid={Boolean(error)}
      aria-describedby={error ? messageId : undefined}
    >
      <legend className="mb-2 text-[0.6875rem] font-bold tracking-[0.16em] text-muted-foreground">
        {label}
        {required ? <RequiredMark /> : null}
        {note ? (
          <span className="ml-2 text-[0.625rem] tracking-normal text-destructive">
            {note}
          </span>
        ) : null}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Button
              key={String(option.value)}
              id={`${id}-${String(option.value)}`}
              type="button"
              variant="outline"
              aria-pressed={selected}
              disabled={disabled || option.disabled}
              className={cn(
                'h-auto min-h-8 rounded-full px-3.5 py-1.5 text-[0.84375rem] font-semibold',
                option.detail && 'flex-col gap-0 py-1',
                selected &&
                  'border-foreground bg-foreground text-background hover:bg-foreground hover:text-background',
              )}
              onClick={() => onChange(option.value)}
            >
              <span>{option.label}</span>
              {option.detail ? (
                <span className="text-[0.625rem] font-medium opacity-60">
                  {option.detail}
                </span>
              ) : null}
            </Button>
          );
        })}
      </div>
      <FieldError id={messageId}>{error}</FieldError>
    </fieldset>
  );
}

function Group({
  title,
  children,
  first = false,
}: {
  title: string;
  children: ReactNode;
  first?: boolean;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        'border-t pt-[1.125rem]',
        first ? 'border-0 pt-0' : 'mt-[1.125rem]',
      )}
    >
      <h2 className="mb-3.5 text-[0.6875rem] font-extrabold tracking-[0.2em] text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function nextPendingId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function replacePendingDesignKind(
  images: readonly PendingDesignImage[],
  fileType: DesignFileType,
  replacement: PendingDesignImage | null,
): PendingDesignImage[] {
  const otherFiles = images.filter(
    (entry) => entry.prepared.fileType !== fileType,
  );
  return replacement ? [...otherFiles, replacement] : otherFiles;
}

function DesignFileBox({
  itemNumber,
  fileType,
  entry,
  disabled,
  required = false,
  error,
  onFile,
  onRemove,
}: {
  itemNumber: number;
  fileType: DesignFileType;
  entry?: PendingDesignImage;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  onFile: (file: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const image = fileType === DesignFileType.IMAGE;
  const errorId = `order-style-${itemNumber}-${image ? 'image' : 'cdr'}-error`;
  const fileLabel = `第 ${itemNumber} 款 ${image ? '设计图' : 'CDR 文件'}`;

  const openFilePicker = () => {
    if (!disabled) inputRef.current?.click();
  };
  const handleDrop: DragEventHandler<HTMLElement> = (event) => {
    if (disabled) return;
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) onFile(file);
  };

  const uploadContent = (
    <>
      {entry ? (
        <div
          data-slot="design-file-marker"
          className="flex h-14 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-[0.625rem] font-bold text-muted-foreground"
        >
          {image ? (
            <LocalDesignImagePreview
              image={entry.prepared}
              alt={`第 ${itemNumber} 款设计图预览：${entry.prepared.file.name}`}
            />
          ) : (
            <span>CDR</span>
          )}
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="text-[0.8125rem] font-bold leading-snug">
          {entry
            ? image
              ? '设计图'
              : 'CDR 文件'
            : image
              ? '粘贴或上传设计图'
              : '上传 CDR 文件'}
          {required && !entry ? <RequiredMark /> : null}
        </p>
        {entry ? (
          <p
            className="mt-0.5 truncate text-[0.6875rem] font-medium text-muted-foreground"
            title={entry.prepared.file.name}
          >
            {entry.prepared.file.name} ·{' '}
            {formatDesignFileSize(entry.prepared.file.size)}
          </p>
        ) : null}
      </div>
    </>
  );

  return (
    <div className="min-w-0">
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        disabled={disabled}
        aria-required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        aria-label={fileLabel}
        accept={
          image
            ? '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp'
            : '.cdr,application/x-cdr,application/octet-stream'
        }
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = '';
        }}
      />
      {entry ? (
        <div
          data-invalid={Boolean(error)}
          className={cn(
            'flex min-h-[5.375rem] w-full items-center gap-3 rounded-xl border bg-card p-3.5 text-left',
            error && 'border-destructive bg-destructive/5',
            disabled && 'opacity-50',
          )}
          onDragOver={(event) => {
            if (!disabled) event.preventDefault();
          }}
          onDrop={handleDrop}
        >
          {uploadContent}
          <div className="flex shrink-0 flex-col gap-1.5">
            <Button
              type="button"
              size="xs"
              variant="outline"
              aria-label={`替换${fileLabel}`}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              disabled={disabled}
              onClick={(event) => {
                event.stopPropagation();
                openFilePicker();
              }}
            >
              替换
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              aria-label={`移除${fileLabel}`}
              className="border-destructive/20 text-destructive hover:bg-destructive/5 hover:text-destructive"
              disabled={disabled}
              onClick={(event) => {
                event.stopPropagation();
                onRemove();
              }}
            >
              移除
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          data-invalid={Boolean(error)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          aria-label={
            image
              ? `粘贴、拖放或选择${fileLabel}`
              : `拖放或选择${fileLabel}`
          }
          className={cn(
            'flex min-h-[5.375rem] w-full cursor-pointer items-center justify-start gap-3 whitespace-normal rounded-xl border-2 border-dashed bg-card p-3.5 text-left outline-none transition-colors hover:border-foreground hover:bg-card hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
            error && 'border-destructive bg-destructive/5',
          )}
          onClick={openFilePicker}
          onDragOver={(event) => {
            if (!disabled) event.preventDefault();
          }}
          onDrop={handleDrop}
          onPaste={(event) => {
            if (disabled || !image) return;
            const file = Array.from(event.clipboardData.files).find(
              (candidate) => candidate.type.startsWith('image/'),
            );
            if (!file) return;
            event.preventDefault();
            onFile(file);
          }}
        >
          {uploadContent}
          <span className="shrink-0 rounded-md border bg-card px-2.5 py-1.5 text-[0.71875rem] font-bold">
            选择文件
          </span>
        </Button>
      )}
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}

function isCopperPaper(
  paperKey: string | null,
  options: readonly OrderPaperSwatchOption[],
): boolean {
  const option = options.find((entry) => entry.value === paperKey);
  const text = `${paperKey ?? ''} ${option?.label ?? ''}`.toLowerCase();
  return text.includes('铜版') || text.includes('coated') || text.includes('tbz');
}

export function parseExternalReceiverDisplay(raw: string): {
  address: string;
  platformCode: string | null;
  receiverName: string | null;
  receiverPhone: string | null;
} {
  const text = raw.trim();
  if (!text) {
    return {
      address: '',
      platformCode: null,
      receiverName: null,
      receiverPhone: null,
    };
  }
  const phone =
    text.match(/1[3-9]\d{9}/)?.[0] ??
    text.match(/\d{3,4}-\d{7,8}/)?.[0] ??
    '';
  const platformCode =
    text.match(/\[[0-9A-Za-z-]{2,}\]|[@#][0-9A-Za-z-]{4,}#?/)?.[0] ??
    null;
  const withoutPhone = text.replace(phone, ' ');
  const parts = withoutPhone
    .split(/[,，;；\n\t]|\s{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const hasSeparator = /[,，;；\n\t]|\s{2,}/.test(withoutPhone);
  let inferredName = phone || hasSeparator ? (parts[0] ?? '') : '';
  inferredName = inferredName
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[@#].*$/, '')
    .replace(/^(?:收货人|联系人|姓名)\s*[:：]?\s*/, '')
    .trim();
  if (
    inferredName.length > 10 ||
    /[省市区县旗镇乡街道路号栋楼层]/.test(inferredName)
  ) {
    inferredName = '';
  }
  const address = parts
    .slice(inferredName ? 1 : 0)
    .join(' ')
    .replace(platformCode ?? '', ' ')
    .replace(/^(?:地址)\s*[:：]?\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    address,
    platformCode,
    receiverName: inferredName || null,
    receiverPhone: phone || null,
  };
}

function currentPrintFoilMode(
  item: CreateOrderInput['items'][number],
): 'NONE' | 'PARTIAL' | 'FULL' {
  if (
    item.frontFoilColors.length === 0 &&
    item.backFoilColors.length === 0
  ) {
    return 'NONE';
  }
  return item.hasLocalFoil === false ? 'FULL' : 'PARTIAL';
}

function FoilSideFields({
  item,
  direct,
  maxSelections,
  disabled,
  error,
  idStem,
  foilOptions,
  onFoilSidesChange,
  onBackFoilToggle,
}: {
  item: CreateOrderInput['items'][number];
  direct: boolean;
  maxSelections: number;
  disabled?: boolean;
  error?: string;
  idStem: string;
  foilOptions: readonly OrderFoilSwatchOption[];
  onFoilSidesChange: (front: string[], back: string[]) => void;
  onBackFoilToggle: (enabled: boolean) => void;
}) {
  const front = item.frontFoilColors;
  const back = item.backFoilColors;
  const backEnabled = back.length > 0 || item.isDoubleSided;

  if (direct) {
    return (
      <div className="mt-5">
        <OrderFoilSwatchPicker
          id={`${idStem}-foil-front`}
          label="烫金颜色"
          value={front}
          options={foilOptions}
          maxSelections={maxSelections}
          minimumSelections={0}
          disabled={disabled}
          error={error}
          onChange={(nextFront) => onFoilSidesChange(nextFront, [])}
        />
      </div>
    );
  }

  const sameAsFront =
    backEnabled &&
    front.length === back.length &&
    front.every((color, index) => color === back[index]);

  return (
    <fieldset className="mt-5 min-w-0" aria-label="烫金颜色">
      <legend className="mb-2 text-[0.6875rem] font-bold tracking-[0.16em] text-muted-foreground">
        烫金颜色
      </legend>
      <div className="rounded-xl bg-muted/30 p-3.5">
        <div className="mb-2.5 flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">
            正面
          </span>
        </div>
        <OrderFoilSwatchPicker
          id={`${idStem}-foil-front`}
          label=""
          value={front}
          options={foilOptions}
          maxSelections={maxSelections}
          minimumSelections={0}
          disabled={disabled}
          onChange={(nextFront) => onFoilSidesChange(nextFront, back)}
        />
      </div>
      <div
        className={cn(
          'mt-2 rounded-xl bg-muted/30 p-3.5',
          !backEnabled && 'bg-muted/15',
        )}
      >
        <div className={cn('flex items-center gap-2', backEnabled && 'mb-2.5')}>
          <span className="text-sm font-semibold text-foreground">
            反面
          </span>
          <span className="text-xs font-semibold text-muted-foreground">
            {backEnabled
              ? sameAsFront
                ? '与正面同色'
                : back.join(' + ') || '未选'
              : '不烫'}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-pressed={backEnabled}
            disabled={disabled}
            className="ml-auto text-xs font-semibold"
            onClick={() => onBackFoilToggle(!backEnabled)}
          >
            {backEnabled ? '取消反面' : '＋ 加烫反面'}
          </Button>
        </div>
        {backEnabled ? (
          <OrderFoilSwatchPicker
            id={`${idStem}-foil-back`}
            label=""
            value={back}
            options={foilOptions}
            maxSelections={maxSelections}
            minimumSelections={0}
            disabled={disabled}
            onChange={(nextBack) => onFoilSidesChange(front, nextBack)}
          />
        ) : null}
      </div>
      <FieldError>{error}</FieldError>
    </fieldset>
  );
}

function SpecialTechnique({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: OrderFoilTechnique;
  disabled?: boolean;
  onChange: (value: OrderFoilTechnique) => void;
}) {
  const options = [
    { value: OrderFoilTechnique.RELIEF, label: '浮雕' },
    { value: OrderFoilTechnique.RAISED, label: '激凸' },
  ] as const;
  return (
    <fieldset className="mt-5">
      <legend className="mb-2 text-[0.6875rem] font-bold tracking-[0.16em] text-muted-foreground">
        特殊工艺
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Button
              key={option.value}
              id={`${id}-${option.value}`}
              type="button"
              variant="outline"
              aria-pressed={selected}
              disabled={disabled}
              className={cn(
                'h-auto min-h-8 rounded-full px-3.5 py-1.5 text-[0.84375rem] font-semibold',
                selected &&
                  'border-foreground bg-foreground text-background hover:bg-foreground hover:text-background',
              )}
              onClick={() =>
                onChange(
                  selected ? OrderFoilTechnique.FLAT : option.value,
                )
              }
            >
              {option.label}
            </Button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function OrderFormB({
  values,
  title = '新建工单',
  settlementLabel,
  customNameRequired = true,
  designImageRequired = true,
  receiverNameRequired = false,
  receiverPhoneRequired = true,
  orderExtras,
  materialExtras,
  pricingExtras,
  shippingExtras,
  afterShipping,
  allowManualWeight = false,
  allowCustomSize = true,
  items,
  itemFields,
  activeIndex,
  pendingDesigns,
  packaging,
  paperOptions,
  paperKey,
  weightOptions,
  specificationOptions,
  foilOptions = FOIL_OPTIONS,
  disabled = false,
  savedLabel,
  fieldErrors,
  rail,
  onActiveIndexChange,
  onAdd,
  onDuplicate,
  onRemove,
  onCustomNameChange,
  onRouteChange,
  onPaperChange,
  onWeightChange,
  onSpecificationChange,
  onFoilSidesChange,
  onBackFoilToggle,
  onFoilTechniqueChange,
  onCustomSizeChange,
  onPrintFoilModeChange,
  onLaminationChange,
  onQuantityChange,
  onPackagingModeChange,
  onUnitsPerBagChange,
  onPendingDesignsChange,
  onReceiverAddressChange,
  onReceiverAddressPaste,
  onReceiverNameChange,
  onReceiverPhoneChange,
  onSfCollectChange,
}: OrderFormBProps) {
  const uid = useId().replaceAll(':', '');
  const safeActiveIndex = Math.min(
    Math.max(0, activeIndex),
    Math.max(0, items.length - 1),
  );
  const item = items[safeActiveIndex];
  const field = itemFields[safeActiveIndex];
  const itemErrors = fieldErrors?.items?.[safeActiveIndex];
  const queue = field ? pendingDesigns[field.id] ?? [] : [];
  const imageEntry = queue.find(
    (entry) => entry.prepared.fileType === DesignFileType.IMAGE,
  );
  const cdrEntry = queue.find(
    (entry) => entry.prepared.fileType === DesignFileType.CDR,
  );
  const [imageFileError, setImageFileError] = useState<{
    fieldId: string;
    message: string;
  } | null>(null);
  const [cdrFileError, setCdrFileError] = useState<{
    fieldId: string;
    message: string;
  } | null>(null);
  const [customNameOverride, setCustomNameOverride] = useState<string | null>(
    null,
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const autoFocusedErrorSignature = useRef<string | null>(null);

  const printFoilMode = useMemo(
    () => (item ? currentPrintFoilMode(item) : 'NONE'),
    [item],
  );
  const copperPaper = isCopperPaper(paperKey, paperOptions);
  const parsedReceiver = parseExternalReceiverDisplay(values.receiverAddress);
  const receiverPhoneInitialValue =
    values.receiverPhone || parsedReceiver.receiverPhone || '';

  const focusIssue = useCallback((message: string) => {
    const itemNumber = Number(message.match(/第\s*(\d+)\s*款/)?.[1]);
    if (Number.isSafeInteger(itemNumber) && itemNumber > 0) {
      onActiveIndexChange(itemNumber - 1);
    }
    window.setTimeout(() => {
      const root = rootRef.current;
      if (!root) return;
      const directSelector = message.includes('工单名称')
        ? '[id$="-custom-name"]'
        : message.includes('收件人')
          ? '[id$="-receiver-name"]'
        : message.includes('收货电话') || message.includes('手机号')
          ? '[id$="-receiver-phone"]'
          : message.includes('收货地址') || message.includes('地址')
            ? '[id$="-receiver-address-paste"]'
            : null;
      const invalidOwner = root.querySelector<HTMLElement>(
        '[aria-invalid="true"], [data-invalid="true"]',
      );
      const target =
        (directSelector
          ? root.querySelector<HTMLElement>(directSelector)
          : null) ??
        invalidOwner?.querySelector<HTMLElement>(
          'input, textarea, button, [role="button"]',
        ) ??
        invalidOwner;
      target?.focus();
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 0);
  }, [onActiveIndexChange]);

  const errorSignature = fieldErrors?.summary?.join('|') ?? '';
  useEffect(() => {
    if (!errorSignature || autoFocusedErrorSignature.current === errorSignature) {
      return;
    }
    autoFocusedErrorSignature.current = errorSignature;
    focusIssue(fieldErrors?.summary?.[0] ?? '');
  }, [errorSignature, fieldErrors?.summary, focusIssue]);

  if (!item || !field) return null;

  const directFoil =
    item.pricingRoute === OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL ||
    item.pricingRoute === OrderItemPricingRoute.COLOR_PRINT;
  const showsFoil =
    item.pricingRoute !== OrderItemPricingRoute.COLOR_PRINT ||
    printFoilMode !== 'NONE';
  const showsSpecialTechnique =
    item.pricingRoute === OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL ||
    (item.pricingRoute === OrderItemPricingRoute.COLOR_PRINT &&
      printFoilMode === 'FULL');
  const customSizeSelected =
    item.actualWidthMm === null && item.actualHeightMm === null;

  const putFile = (file: File, expectedType: DesignFileType) => {
    const prepared = prepareDesignFile(file, {
      fallbackStem: `style-${safeActiveIndex + 1}-design-${Date.now()}`,
    });
    const setErrorState =
      expectedType === DesignFileType.IMAGE
        ? setImageFileError
        : setCdrFileError;
    const setError = (message: string | null) =>
      setErrorState(message ? { fieldId: field.id, message } : null);
    if (!prepared.ok) {
      setError(prepared.message);
      return;
    }
    if (prepared.value.fileType !== expectedType) {
      setError(
        expectedType === DesignFileType.IMAGE
          ? '设计图仅支持 JPG、PNG 或 WEBP'
          : '请选择 CDR 文件',
      );
      return;
    }
    setError(null);
    onPendingDesignsChange(
      replacePendingDesignKind(queue, expectedType, {
        id: nextPendingId(),
        prepared: prepared.value,
      }),
    );
  };

  return (
    <div
      ref={rootRef}
      data-slot="order-form-b"
      className="@container mx-auto w-full max-w-[1180px] px-0 pb-10 font-sans tabular-nums"
      onPaste={(event) => {
        const target = event.target as HTMLElement;
        if (
          disabled ||
          target.matches('input, textarea') ||
          target.isContentEditable
        ) {
          return;
        }
        const file = Array.from(event.clipboardData.files).find((candidate) =>
          candidate.type.startsWith('image/'),
        );
        if (!file) return;
        event.preventDefault();
        putFile(file, DesignFileType.IMAGE);
      }}
    >
      <header className="mb-[1.125rem] flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[1.3125rem] font-extrabold tracking-tight">
          {title}
        </h1>
        {settlementLabel ? (
          <span className="rounded-full border px-3 py-1 text-[0.71875rem] font-semibold text-muted-foreground">
            {settlementLabel}
          </span>
        ) : null}
      </header>

      <nav
        aria-label="款式"
        className="mb-[1.125rem] flex flex-wrap items-center gap-1.5"
      >
        {itemFields.map((entry, index) => (
          <Button
            key={entry.id}
            type="button"
            variant="outline"
            aria-pressed={safeActiveIndex === index}
            disabled={disabled}
            className={cn(
              'h-auto min-h-8 rounded-[9px] px-3.5 py-1.5 text-[0.8125rem] font-bold',
              safeActiveIndex === index &&
                'border-foreground bg-foreground text-background hover:bg-foreground hover:text-background',
            )}
            onClick={() => onActiveIndexChange(index)}
          >
            {index + 1}. {ROUTE_OPTIONS.find((route) => route.value === items[index]?.pricingRoute)?.label ?? '款式'}
            {fieldErrors?.items?.[index] ? (
              <span
                aria-label="有待处理项"
                className="size-1.5 rounded-full bg-destructive"
              />
            ) : null}
          </Button>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className="h-auto min-h-8 rounded-[9px] border-dashed px-3.5 py-1.5 text-[0.8125rem] font-extrabold text-muted-foreground"
          onClick={onAdd}
        >
          ＋ 加款
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className="h-auto min-h-8 rounded-[9px] border-dashed px-3.5 py-1.5 text-[0.8125rem] font-extrabold text-muted-foreground"
          onClick={() => onDuplicate(safeActiveIndex)}
        >
          ⧉ 复制当前
        </Button>
        {itemFields.length > 1 ? (
          <Button
            type="button"
            variant="outline"
            aria-label={`删除第 ${safeActiveIndex + 1} 款`}
            disabled={disabled}
            className="h-auto min-h-8 rounded-[9px] px-3.5 py-1.5 text-[0.8125rem] font-extrabold text-destructive hover:bg-destructive/5 hover:text-destructive"
            onClick={() => onRemove(safeActiveIndex)}
          >
            删除当前
          </Button>
        ) : null}
        <span className="ml-auto flex items-center gap-1.5 text-[0.71875rem] font-semibold text-muted-foreground">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
          {savedLabel}
        </span>
      </nav>

      <div
        data-slot="order-form-layout"
        className="grid grid-cols-1 items-start gap-[1.375rem] @min-[881px]:grid-cols-[minmax(0,1fr)_310px]"
      >
        <div
          data-slot="order-form-editor"
          className="@container min-w-0 rounded-[14px] border bg-card p-5"
        >
          {fieldErrors?.summary && fieldErrors.summary.length > 0 ? (
            <div
              role="alert"
              className="mb-4 rounded-xl border border-destructive bg-destructive/5 px-4 py-3.5 text-destructive"
            >
              <h2 className="text-sm font-extrabold">
                还有 {fieldErrors.summary.length} 处需要处理
              </h2>
              <ul className="mt-2 space-y-0.5 text-xs font-semibold">
                {fieldErrors.summary.map((message, index) => (
                  <li key={`${message}-${index}`}>
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto! min-h-0! min-w-0! justify-start px-0! py-1 text-left whitespace-normal text-destructive underline underline-offset-2 hover:text-destructive hover:opacity-70"
                      onClick={() => focusIssue(message)}
                    >
                      {message}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <Group title="工单" first>
            <div>
              <FieldLabel
                htmlFor={`${uid}-custom-name`}
                required={customNameRequired}
              >
                工单名称
              </FieldLabel>
          <Input
            id={`${uid}-custom-name`}
            value={customNameOverride ?? values.customName}
                required={customNameRequired}
                aria-required={customNameRequired}
                aria-invalid={Boolean(fieldErrors?.customName)}
                aria-describedby={
                  fieldErrors?.customName
                    ? `${uid}-custom-name-message`
                    : undefined
                }
                disabled={disabled}
                placeholder="例：新年快樂 六款"
                className="h-10"
            onChange={(event) => {
              const nextValue = event.currentTarget.value;
              setCustomNameOverride(nextValue);
              onCustomNameChange(nextValue);
            }}
              />
              <FieldError id={`${uid}-custom-name-message`}>
                {fieldErrors?.customName}
              </FieldError>
            </div>
            {orderExtras}
          </Group>

          <Group title={`工艺 · 第 ${safeActiveIndex + 1} 款`}>
            <PillPicker
              id={`${uid}-route`}
              label="工艺类型"
              value={item.pricingRoute}
              options={ROUTE_OPTIONS}
              disabled={disabled}
              error={itemErrors?.route}
              onChange={onRouteChange}
            />

            {item.pricingRoute === OrderItemPricingRoute.COLOR_PRINT ? (
              <div className="mt-5 space-y-5">
                {copperPaper ? (
                  <PillPicker
                    id={`${uid}-lamination`}
                    label="覆膜"
                    value={item.lamination}
                    options={LAMINATION_OPTIONS}
                    disabled={disabled}
                    onChange={onLaminationChange}
                  />
                ) : null}
                <PillPicker
                  id={`${uid}-print-foil`}
                  label="叠加烫金"
                  value={printFoilMode}
                  options={[
                    { value: 'NONE', label: '无' },
                    { value: 'PARTIAL', label: '局部烫金' },
                    { value: 'FULL', label: '专版烫金' },
                  ]}
                  disabled={disabled}
                  onChange={onPrintFoilModeChange}
                />
              </div>
            ) : null}

            {showsFoil ? (
              <FoilSideFields
                item={item}
                direct={directFoil}
                maxSelections={
                  item.pricingRoute === OrderItemPricingRoute.COLOR_PRINT ? 1 : 3
                }
                disabled={disabled}
                error={itemErrors?.foilColors}
                idStem={`${uid}-style-${safeActiveIndex}`}
                foilOptions={foilOptions}
                onFoilSidesChange={onFoilSidesChange}
                onBackFoilToggle={onBackFoilToggle}
              />
            ) : null}

            {showsSpecialTechnique ? (
              <SpecialTechnique
                id={`${uid}-special-technique`}
                value={item.foilTechnique}
                disabled={disabled}
                onChange={onFoilTechniqueChange}
              />
            ) : null}
          </Group>

          <Group title="材料">
            {materialExtras}
            <OrderPaperSwatchPicker
              id={`${uid}-paper`}
              value={paperKey}
              options={paperOptions}
              disabled={disabled}
              error={itemErrors?.paper}
              onChange={onPaperChange}
            />

            <div className="mt-5">
              <PillPicker
                id={`${uid}-weight`}
                label="克重"
                value={item.paperWeightGsm ?? 0}
                options={weightOptions.map((option) => ({
                  ...option,
                  label: `${option.value}g`,
                }))}
                disabled={disabled}
                error={itemErrors?.weight}
                onChange={onWeightChange}
              />
              {allowManualWeight &&
              item.pricingRoute ===
                OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL ? (
                <div className="mt-2">
                  <div className="flex max-w-[11rem] items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={2000}
                      step={1}
                      aria-label="手动输入克重"
                      placeholder="手动输入"
                      disabled={disabled}
                      value={
                        item.paperWeightGsm !== null &&
                        !weightOptions.some((option) => option.value === item.paperWeightGsm)
                          ? item.paperWeightGsm
                          : ''
                      }
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (Number.isInteger(next) && next > 0) {
                          onWeightChange(next);
                        }
                      }}
                    />
                    <span className="text-xs font-bold text-muted-foreground">g</span>
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    手动输入克重转管理员终价
                  </p>
                </div>
              ) : null}
            </div>

            <div className="mt-5">
              <PillPicker
                id={`${uid}-specification`}
                label="规格"
                value={item.specification ?? ''}
                options={specificationOptions}
                disabled={disabled}
                error={itemErrors?.specification}
                onChange={onSpecificationChange}
              />
              {item.pricingRoute === OrderItemPricingRoute.STOCK_BLANK &&
              paperKey !== 'PEARL_FLASH' ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  迷你封仅珠光纸艳闪可做
                </p>
              ) : null}
              {allowCustomSize &&
              item.pricingRoute ===
                OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL ? (
                <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-1 text-[0.8125rem] font-semibold has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60">
                  <Checkbox
                    checked={customSizeSelected}
                    disabled={disabled}
                    aria-label="改尺寸（转管理员终价）"
                    onCheckedChange={onCustomSizeChange}
                  />
                  改尺寸（转管理员终价）
                </label>
              ) : null}
            </div>
          </Group>

          <Group title="数量与包装">
            <div className="grid grid-cols-1 gap-3.5 @min-[560px]:grid-cols-2">
              <div>
                <FieldLabel htmlFor={`${uid}-quantity`} required>
                  数量
                </FieldLabel>
                <Input
                  id={`${uid}-quantity`}
                  type="number"
                  min={1}
                  step={1}
                  required
                  aria-required="true"
                  aria-invalid={Boolean(itemErrors?.quantity)}
                  disabled={disabled}
                  value={item.quantity || ''}
                  className="h-10"
                  onChange={(event) =>
                    onQuantityChange(Number.parseInt(event.target.value, 10) || 0)
                  }
                />
                <FieldError>{itemErrors?.quantity}</FieldError>
              </div>
              <div>
                <FieldLabel htmlFor={`${uid}-units-per-bag`} required>
                  每包数量
                </FieldLabel>
                <Input
                  id={`${uid}-units-per-bag`}
                  type="number"
                  min={1}
                  step={1}
                  required
                  aria-required="true"
                  aria-invalid={Boolean(
                    packaging.error || fieldErrors?.packaging,
                  )}
                  disabled={disabled}
                  value={packaging.unitsPerBag || ''}
                  className="h-10"
                  onChange={(event) =>
                    onUnitsPerBagChange(
                      Number.parseInt(event.target.value, 10) || 0,
                    )
                  }
                />
                {packaging.bagCount !== null && !packaging.error ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    共 {packaging.bagCount.toLocaleString('zh-CN')} 包
                  </p>
                ) : null}
                <FieldError>
                  {packaging.error ?? fieldErrors?.packaging}
                </FieldError>
              </div>
            </div>
            <div className="mt-5">
              <PillPicker
                id={`${uid}-packaging-mode`}
                label="包装方式"
                value={packaging.mode}
                options={[
                  {
                    value: OrderPackagingMode.SINGLE_STYLE,
                    label: '常规装',
                  },
                  {
                    value: OrderPackagingMode.MIXED_STYLE,
                    label: '混装',
                    disabled: itemFields.length < 2,
                  },
                ]}
                disabled={disabled}
                note={itemFields.length < 2 ? '混装需两款以上' : undefined}
                onChange={onPackagingModeChange}
              />
            </div>
          </Group>

          {pricingExtras}

          <Group title="文件">
            <fieldset>
              <legend className="mb-2 text-[0.6875rem] font-bold tracking-[0.16em] text-muted-foreground">
                设计文件
                {designImageRequired ? <RequiredMark /> : null}
              </legend>
              <div className="grid grid-cols-1 gap-3 @min-[560px]:grid-cols-2">
                <DesignFileBox
                  itemNumber={safeActiveIndex + 1}
                  fileType={DesignFileType.IMAGE}
                  entry={imageEntry}
                  disabled={disabled}
                  required={designImageRequired}
                  error={
                    (imageFileError?.fieldId === field.id
                      ? imageFileError.message
                      : undefined) ?? itemErrors?.designImage
                  }
                  onFile={(file) => putFile(file, DesignFileType.IMAGE)}
                  onRemove={() =>
                    onPendingDesignsChange(
                      replacePendingDesignKind(
                        queue,
                        DesignFileType.IMAGE,
                        null,
                      ),
                    )
                  }
                />
                <DesignFileBox
                  itemNumber={safeActiveIndex + 1}
                  fileType={DesignFileType.CDR}
                  entry={cdrEntry}
                  disabled={disabled}
                  error={
                    cdrFileError?.fieldId === field.id
                      ? cdrFileError.message
                      : undefined
                  }
                  onFile={(file) => putFile(file, DesignFileType.CDR)}
                  onRemove={() =>
                    onPendingDesignsChange(
                      replacePendingDesignKind(
                        queue,
                        DesignFileType.CDR,
                        null,
                      ),
                    )
                  }
                />
              </div>
            </fieldset>
          </Group>

          <Group title="收货">
            {shippingExtras}
            <div>
              <FieldLabel htmlFor={`${uid}-receiver-address-paste`} required>
                收货地址
              </FieldLabel>
              <Textarea
                id={`${uid}-receiver-address-paste`}
                value={values.receiverAddress}
                required
                aria-required="true"
                aria-invalid={Boolean(fieldErrors?.receiverAddress)}
                disabled={disabled}
                placeholder="粘贴电商后台地址串，自动拆分"
                className="min-h-16"
                onPaste={onReceiverAddressPaste}
                onChange={(event) =>
                  onReceiverAddressChange(event.target.value)
                }
              />
              <FieldError>{fieldErrors?.receiverAddress}</FieldError>
            </div>

            {values.receiverAddress.trim() ? (
              <div className="mt-3 overflow-hidden rounded-xl border">
                <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center border-b px-3 py-2.5">
                  <label
                    htmlFor={`${uid}-receiver-name`}
                    className="text-[0.65625rem] font-bold tracking-[0.14em] text-muted-foreground"
                  >
                    收件人
                    {receiverNameRequired ? (
                      <span aria-hidden="true" className="ml-0.5 text-destructive">
                        *
                      </span>
                    ) : null}
                  </label>
                  <Input
                    key={`${uid}-receiver-name-${values.receiverAddress}`}
                    id={`${uid}-receiver-name`}
                    defaultValue={
                      values.receiverName || parsedReceiver.receiverName || ''
                    }
                    aria-invalid={Boolean(fieldErrors?.receiverName)}
                    required={receiverNameRequired}
                    aria-required={receiverNameRequired}
                    disabled={disabled}
                    className="h-7 border-0 bg-transparent px-0 font-semibold shadow-none focus-visible:ring-0"
                    placeholder="请填写收件人"
                    onChange={(event) => {
                      const nextValue = event.currentTarget.value;
                      onReceiverNameChange(nextValue);
                    }}
                  />
                  {fieldErrors?.receiverName ? (
                    <div className="col-start-2">
                      <FieldError>{fieldErrors.receiverName}</FieldError>
                    </div>
                  ) : null}
                </div>
                <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center border-b px-3 py-2.5">
                  <label
                    htmlFor={`${uid}-receiver-phone`}
                    className="text-[0.65625rem] font-bold tracking-[0.14em] text-muted-foreground"
                  >
                    电话
                  </label>
                  <input
                    key={`${uid}-receiver-phone-${values.receiverAddress}`}
                    id={`${uid}-receiver-phone`}
                    type="tel"
                    defaultValue={receiverPhoneInitialValue}
                    required={receiverPhoneRequired}
                    aria-required={receiverPhoneRequired}
                    aria-invalid={Boolean(fieldErrors?.receiverPhone)}
                    disabled={disabled}
                    className="h-7 w-full min-w-0 border-0 bg-transparent px-0 py-1 font-mono text-sm font-semibold outline-none placeholder:text-muted-foreground focus-visible:ring-0 disabled:opacity-50"
                    placeholder="请填写收货电话"
                    onChange={(event) => {
                      const nextValue = event.currentTarget.value;
                      onReceiverPhoneChange(nextValue);
                    }}
                  />
                  {fieldErrors?.receiverPhone ? (
                    <div className="col-start-2">
                      <FieldError>{fieldErrors.receiverPhone}</FieldError>
                    </div>
                  ) : null}
                </div>
                <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center px-3 py-2.5">
                  <span className="text-[0.65625rem] font-bold tracking-[0.14em] text-muted-foreground">
                    地址
                  </span>
                  <p className="min-w-0 break-words text-[0.8125rem] font-semibold">
                    {parsedReceiver.address || '—'}
                  </p>
                </div>
                {parsedReceiver.platformCode ? (
                  <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center border-t px-3 py-2.5">
                    <span className="text-[0.65625rem] font-bold tracking-[0.14em] text-muted-foreground">
                      平台码
                    </span>
                    <p className="min-w-0 break-words font-mono text-[0.8125rem] font-semibold">
                      {parsedReceiver.platformCode}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-1 text-[0.8125rem] font-semibold has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60">
              <Checkbox
                checked={values.isSfCollect ?? false}
                disabled={disabled}
                aria-label="顺丰到付（本单不计快递费）"
                onCheckedChange={onSfCollectChange}
              />
              顺丰到付（本单不计快递费）
            </label>
          </Group>
          {afterShipping}
        </div>

        <StickyOrderFormRail rail={rail} />
      </div>
    </div>
  );
}
