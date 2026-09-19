'use client';
import { OrderSpecificationTabs } from './OrderSpecificationTabs';
import { EditorTabs } from '@/components/ui/editor-tabs';
import { orderDesignGroups } from '@/lib/order/design-groups';
import { MAX_ORDER_ITEMS_PER_ORDER } from '@/lib/order/limits';
import { OrderPurposePicker } from '../OrderPurposePicker';
import {
  isMixedPackaging,
  packagingType,
  packagingBoxType,
  packagingModeFor,
  packagingCapacity,
  PACKAGING_BOXES,
  type PackagingType,
  type PackagingBoxType,
} from '@/lib/order/packaging-mode';

import { Group, FieldLabel, FieldError, RequiredMark, PillPicker } from './OrderFieldPrimitives';
import { OrderItemCraftFields, OrderItemMaterialFields, OrderItemSpecificationFields, OrderItemQuantityField, ROUTE_OPTIONS } from './OrderItemFields';

import { OrderReceiverContactFields } from '../OrderReceiverContactFields';
import { ReceiverAddressPasteField } from '../ReceiverAddressPasteField';
import { parseExternalReceiverDisplay } from '@/lib/order/receiver-address-paste';

import {
  useId,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEventHandler,
  type DragEventHandler,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
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
  type OrderFoilSwatchOption,
} from './OrderFoilSwatchPicker';
import {
  type OrderPaperSwatchOption,
} from './OrderPaperSwatchPicker';

const FOIL_OPTIONS: readonly OrderFoilSwatchOption[] = [
  { value: '亚金', label: '亚金', tone: 'matte-gold' },
  { value: '浅色', label: '浅金', tone: 'light-gold' },
  { value: '红色', label: '红金', tone: 'red' },
  { value: '黑色', label: '黑金', tone: 'black' },
  { value: '银色', label: '银金', tone: 'silver' },
  { value: '蓝色', label: '蓝金', tone: 'blue' },
  { value: '透明色', label: '透明金', tone: 'clear' },
  { value: '绿色', label: '绿金', tone: 'green' },
];

function StickyOrderFormRail({ rail }: { rail: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const [fitsViewport, setFitsViewport] = useState(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const element = railRef.current;
    if (!container || !element) return;
    const measure = () => {
      // Keep long fee summaries in document flow so every action is reachable.
      const top = Math.max(70, container.getBoundingClientRect().top);
      setFitsViewport(top + element.getBoundingClientRect().height <= window.innerHeight - 16);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(container);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
    };
  }, []);

  return (
    <div ref={containerRef} className="min-w-0">
      <aside
        ref={railRef}
        data-slot="order-form-rail"
        className={cn('min-w-0', fitsViewport && '@min-[881px]:sticky @min-[881px]:top-[70px]')}
      >
        {rail}
      </aside>
    </div>
  );
}

export type OrderFormBErrors = {
  summary?: readonly string[];
  targets?: Readonly<Record<string, { fieldId: string; itemIndex?: number }>>;
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
  packagingExtras?: ReactNode;
  orderPackagingExtras?: ReactNode;
  afterShipping?: ReactNode;
  footerExtras?: ReactNode;
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
    scopeLabel?: string;
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
  /** Increment only after an explicit submit attempt fails. */
  errorFocusRequest?: number;
  errorFocusMessage?: string;
  rail: ReactNode;
  onActiveIndexChange: (index: number) => void;
  onAdd: () => void;
  onAddSpecification?: () => void;
  onDuplicate: (index: number) => void;
  onRemove: (index: number) => void;
  onCustomNameChange: (value: string) => void;
  onPurposeChange?: (value: 'SAMPLE_SHIPMENT' | 'PROOF') => void;
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
  onFiles,
  onRemove,
}: {
  itemNumber: number;
  fileType: DesignFileType;
  entry?: PendingDesignImage;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  onFiles?: (files: File[]) => void;
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
    const files = Array.from(event.dataTransfer.files);
    if (onFiles) onFiles(files);
    else if (files[0]) onFile(files[0]);
  };

  const uploadContent = (
    <>
      {entry ? (
        <div
          data-slot="design-file-marker"
          className="flex h-14 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-xs font-bold text-muted-foreground"
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
        <p className="text-sm font-bold leading-snug">
          {entry
            ? image
              ? '设计图'
              : 'CDR 文件'
            : image
              ? '粘贴或上传设计图'
              : '上传 CDR 文件'}
          {required && !entry ? <RequiredMark /> : null}
        </p>
        {!entry ? (
          <p className="mt-0.5 text-xs font-medium text-muted-foreground">
            {image ? '可粘贴或拖放图片' : '可多选或拖放多个文件'}
          </p>
        ) : null}
        {entry ? (
          <p
            className="mt-0.5 truncate text-xs font-medium text-muted-foreground"
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
        multiple={Boolean(onFiles)}
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
          const files = Array.from(event.target.files ?? []);
          if (onFiles) onFiles(files);
          else if (files[0]) onFile(files[0]);
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
            'flex h-auto data-[slot=button]:min-h-44 w-full cursor-pointer flex-col items-start justify-between gap-4 whitespace-normal rounded-xl border-2 border-dashed bg-muted/20 p-4 text-left outline-none transition-colors hover:border-primary hover:bg-primary/5 hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
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
          <span className="shrink-0 rounded-md border bg-card px-2.5 py-1.5 text-xs font-bold">
            选择文件
          </span>
        </Button>
      )}
      <FieldError id={errorId} reservedLines={2}>{error}</FieldError>
    </div>
  );
}

// Tests and older callers import the parser from here.
export { parseExternalReceiverDisplay };

function OrderDesignFilesSection({ itemNumber, queue, disabled, required, grouped, imageError, cdrError, onImage, onCdrFiles, onChange }: {
  itemNumber: number;
  queue: PendingDesignImage[];
  disabled?: boolean;
  required?: boolean;
  grouped: boolean;
  imageError?: string;
  cdrError?: string;
  onImage: (file: File) => void;
  onCdrFiles: (files: File[]) => void;
  onChange: (files: PendingDesignImage[]) => void;
}) {
  const imageEntry = queue.find((entry) => entry.prepared.fileType === DesignFileType.IMAGE);
  const cdrEntries = queue.filter((entry) => entry.prepared.fileType === DesignFileType.CDR);
  return (
    <Group title="设计图与设计文件" appearance={grouped ? 'plain' : 'divided'}
      description={grouped ? '当前设计款共用' : undefined}>
      <fieldset>
        <legend className="sr-only">
          设计文件
          {required ? <RequiredMark /> : null}
        </legend>
        <div className="grid grid-cols-1 gap-3 @min-[560px]:grid-cols-2">
          <DesignFileBox
            itemNumber={itemNumber}
            fileType={DesignFileType.IMAGE}
            entry={imageEntry}
            disabled={disabled}
            required={required}
            error={imageError}
            onFile={onImage}
            onRemove={() =>
              onChange(
                replacePendingDesignKind(
                  queue,
                  DesignFileType.IMAGE,
                  null,
                ),
              )
            }
          />
          <div className="min-w-0 space-y-2">
            <DesignFileBox
              itemNumber={itemNumber}
              fileType={DesignFileType.CDR}
              disabled={disabled}
              error={cdrError}
              onFiles={onCdrFiles}
              onFile={(file) => onCdrFiles([file])}
              onRemove={() => {}}
            />
            {cdrEntries.map((entry) => (
              <div key={entry.id} className="flex min-w-0 items-center gap-2 rounded-xl border bg-card p-3">
                <span data-slot="design-file-marker" className="shrink-0 text-xs font-bold text-muted-foreground"><span>CDR</span></span>
                <p className="min-w-0 flex-1 truncate text-sm" title={entry.prepared.file.name}>
                  {entry.prepared.file.name} · {formatDesignFileSize(entry.prepared.file.size)}
                </p>
                <Button
                  type="button" variant="outline" disabled={disabled}
                  className="min-h-11 min-w-11 shrink-0"
                  aria-label={`移除第 ${itemNumber} 款 CDR 文件 ${entry.prepared.file.name}`}
                  onClick={() => onChange(queue.filter((file) => file.id !== entry.id))}
                >移除</Button>
              </div>
            ))}
          </div>
        </div>
      </fieldset>
    </Group>
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
  packagingExtras,
  orderPackagingExtras,
  afterShipping,
  footerExtras,
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
  errorFocusRequest = 0,
  errorFocusMessage,
  rail,
  onActiveIndexChange,
  onAdd,
  onAddSpecification,
  onDuplicate,
  onRemove,
  onCustomNameChange,
  onRouteChange,
  onPurposeChange,
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
  const groups = orderDesignGroups(items.slice(0, itemFields.length));
  const activeGroup = groups.find((group) => group.indexes.includes(safeActiveIndex));
  const designNumber = onAddSpecification ? groups.findIndex((group) => group === activeGroup) + 1 : safeActiveIndex + 1;
  const item = items[safeActiveIndex];
  const field = itemFields[safeActiveIndex];
  const itemErrors = fieldErrors?.items?.[safeActiveIndex];
  const queue = field ? pendingDesigns[field.id] ?? [] : [];
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
  const { rootRef, handledErrorFocusRequestRef, issueFocusTimerRef, removeButtonRef,
    styleNavRef, restoreDeleteFocusRef, cancelIssueFocus } = useOrderFormFocus(itemFields.length);

  const parsedReceiver = parseExternalReceiverDisplay(values.receiverAddress);
  const receiverPhoneInitialValue =
    values.receiverPhone || parsedReceiver.receiverPhone || '';

  const focusIssue = useCallback((message: string) => {
    cancelIssueFocus();
    const explicitTarget = fieldErrors?.targets?.[message];
    if (explicitTarget?.itemIndex !== undefined) onActiveIndexChange(explicitTarget.itemIndex);
    const itemNumber = Number(message.match(/第\s*(\d+)\s*款/)?.[1]);
    if (explicitTarget?.itemIndex === undefined && Number.isSafeInteger(itemNumber) && itemNumber > 0) {
      const index = items.findIndex(
        (entry, index) => (entry.fig ?? index + 1) === itemNumber,
      );
      if (index >= 0) onActiveIndexChange(index);
    }
    issueFocusTimerRef.current = window.setTimeout(() => {
      issueFocusTimerRef.current = null;
      const root = rootRef.current;
      if (!root) return;
      const addressNumber = Number(message.match(/地址\s*(\d+)/)?.[1]);
      const extraContact = addressNumber >= 2 && (message.includes('收件人') || message.includes('电话'))
        ? `[name="additionalShipments.${addressNumber - 2}.${message.includes('收件人') ? 'receiverName' : 'receiverPhone'}"]`
        : null;
      const directSelector = (explicitTarget ? `[id="${CSS.escape(explicitTarget.fieldId)}"]` : null) ?? extraContact ?? (message.includes('承诺交期')
        ? '#promisedDate'
        : message.includes('产品客户')
        ? '#customerRef'
        : message.includes('工单备注')
        ? '#remark'
        : message.includes('工单名称')
        ? '[id$="-custom-name"]'
        : message.includes('收件人')
          ? '[id$="-receiver-name"]'
        : message.includes('收货电话') || message.includes('手机号')
          ? '[id$="-receiver-phone"]'
          : message.includes('收货地址') || message.includes('地址')
            ? '[id$="-receiver-address-paste"]'
            : null);
      const invalidOwner = root.querySelector<HTMLElement>(
        '[aria-invalid="true"]:not([tabindex="-1"]), [data-invalid="true"]',
      );
      const target =
        (explicitTarget?.fieldId.endsWith('.quantity') ? root.querySelector<HTMLElement>('[id$="-quantity"]') : null) ??
        (explicitTarget?.fieldId === 'receiverAddress' ? root.querySelector<HTMLElement>('[id$="-receiver-address-paste"]') : null) ??
        (directSelector
          ? root.querySelector<HTMLElement>(directSelector)
          : null) ??
        invalidOwner?.querySelector<HTMLElement>(
          'input:not([tabindex="-1"]), textarea, button, [role="button"]',
        ) ??
        invalidOwner ??
        root.querySelector<HTMLElement>('[data-slot="order-form-errors"]');
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({
        block: 'center',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      });
    }, 0);
  }, [cancelIssueFocus, fieldErrors?.targets, items, onActiveIndexChange, issueFocusTimerRef, rootRef]);

  useEffect(() => {
    if (
      !errorFocusRequest ||
      handledErrorFocusRequestRef.current === errorFocusRequest
    ) {
      return;
    }
    handledErrorFocusRequestRef.current = errorFocusRequest;
    if (errorFocusMessage) focusIssue(errorFocusMessage);
    else if (fieldErrors?.summary?.length) focusIssue(fieldErrors.summary[0]);
  }, [errorFocusRequest, errorFocusMessage, fieldErrors?.summary, focusIssue, handledErrorFocusRequestRef]);

  if (!item || !field) return null;

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

  const appendCdrFiles = (files: File[]) => {
    const additions: PendingDesignImage[] = [];
    const errors: string[] = [];
    for (const file of files) {
      const prepared = prepareDesignFile(file);
      if (!prepared.ok) errors.push(`${file.name}：${prepared.message}`);
      else if (prepared.value.fileType !== DesignFileType.CDR) {
        errors.push(`${file.name}：请选择 CDR 文件`);
      } else {
        additions.push({ id: nextPendingId(), prepared: prepared.value });
      }
    }
    setCdrFileError(errors.length ? { fieldId: field.id, message: errors.join('；') } : null);
    if (additions.length) onPendingDesignsChange([...queue, ...additions]);
  };

  return (
    <div
      ref={rootRef}
      data-slot="order-form-b"
      className="@container w-full min-w-0 px-0 pb-10 font-sans tabular-nums [overflow-anchor:none]"
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
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-extrabold tracking-tight">
          {title}
        </h1>
        {settlementLabel ? (
          <span className="rounded-full border px-3 py-1 text-xs font-semibold text-muted-foreground">
            {settlementLabel}
          </span>
        ) : null}
      </header>

      {!onAddSpecification ? <><div
        role="group"
        aria-label="款式操作"
        className="mb-3 flex flex-wrap items-center gap-1.5"
      >
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className="min-h-11 rounded-lg border-dashed px-3 py-1.5 text-sm font-semibold text-muted-foreground"
          onClick={() => {
            cancelIssueFocus();
            onAdd();
          }}
        >
          ＋ 加款
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className="min-h-11 rounded-lg border-dashed px-3 py-1.5 text-sm font-semibold text-muted-foreground"
          onClick={() => {
            cancelIssueFocus();
            onDuplicate(safeActiveIndex);
          }}
        >
          ⧉ 复制当前
        </Button>
        {itemFields.length > 1 ? (
          <Button
            ref={removeButtonRef}
            type="button"
            variant="outline"
            aria-label={`删除第 ${safeActiveIndex + 1} 款`}
            disabled={disabled}
            className="min-h-11 rounded-lg px-3 py-1.5 text-sm font-semibold text-destructive hover:bg-destructive/5 hover:text-destructive"
            onClick={() => {
              cancelIssueFocus();
              restoreDeleteFocusRef.current = true;
              onRemove(safeActiveIndex);
            }}
          >
            删除当前
          </Button>
        ) : null}
        <span className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
          {savedLabel}
        </span>
      </div>

      <nav
        ref={styleNavRef}
        aria-label="款式"
        className="mb-4 flex flex-wrap items-center gap-1.5"
      >
        {itemFields.map((entry, index) => (
          <Button
            key={entry.id}
            type="button"
            variant="outline"
            aria-pressed={safeActiveIndex === index}
            disabled={disabled}
            className={cn(
              'h-auto min-h-11 rounded-lg px-3.5 py-1.5 text-sm font-bold',
              safeActiveIndex === index &&
                'border-foreground bg-foreground text-background hover:bg-foreground hover:text-background dark:border-foreground dark:bg-foreground dark:text-background dark:hover:bg-foreground dark:hover:text-background',
            )}
            onClick={() => {
              cancelIssueFocus();
              onActiveIndexChange(index);
            }}
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
      </nav></> : <div className="mb-4 space-y-3">
        <p className="text-xs text-muted-foreground">{savedLabel} · {groups.length} 个设计款，{items.length} 个规格明细</p>
      </div>}

      <div
        data-slot="order-form-layout"
        className="grid grid-cols-1 items-start gap-6 @min-[881px]:grid-cols-[minmax(0,1fr)_310px]"
      >
        <div
          data-slot="order-form-editor"
          className={cn('@container min-w-0', onAddSpecification ? 'space-y-6' : 'rounded-xl border bg-card p-5')}
        >
          <div className={onAddSpecification ? 'space-y-5 rounded-xl border bg-card p-4 @min-[560px]:p-5' : undefined}>
          <Group title="工单" first appearance={onAddSpecification ? 'plain' : 'divided'}>
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
              <FieldError id={`${uid}-custom-name-message`} reservedLines={1}>
                {fieldErrors?.customName}
              </FieldError>
            </div>
            {orderExtras}
          </Group>

          {onPurposeChange ? <OrderPurposePicker
            value={item.pricingRoute} disabled={Boolean(disabled)}
            onChange={(value) => {
              if (value === 'PROOF' || value === 'SAMPLE_SHIPMENT') onPurposeChange(value);
              else if (value === 'STOCK_BLANK' || value === 'CUSTOM_SINGLE_FLAT_FOIL' || value === 'COLOR_PRINT') onRouteChange(value);
            }}
          /> : null}
          </div>
          <div data-slot="order-design-section" className={onAddSpecification ? 'min-w-0 rounded-xl border bg-card' : undefined}>
          {onAddSpecification ? <div className="space-y-3 rounded-t-xl bg-muted/30 px-4 pt-4 @min-[560px]:px-5">
            <div className="flex flex-wrap items-start gap-2">
              <EditorTabs ref={styleNavRef} id={`${uid}-design`} label="设计款" variant="folder" disabled={disabled}
                tabs={groups.map((group, index) => ({ value: itemFields[group.indexes[0]].id,
                  label: `设计款 ${index + 1}${group.indexes.some((member) => fieldErrors?.items?.[member]) ? ' · 待完善' : ''}` }))}
                value={itemFields[activeGroup?.indexes[0] ?? safeActiveIndex].id}
                onChange={(value) => { cancelIssueFocus(); onActiveIndexChange(itemFields.findIndex((entry) => entry.id === value)); }} />
              <Button type="button" variant="outline" disabled={disabled || items.length >= MAX_ORDER_ITEMS_PER_ORDER} onClick={onAdd}>＋ 增加设计款</Button>
            </div>
            {items.length >= MAX_ORDER_ITEMS_PER_ORDER ? <p className="text-sm text-muted-foreground">每张工单最多 {MAX_ORDER_ITEMS_PER_ORDER} 个规格明细。</p> : null}
          </div> : null}
          <div role={onAddSpecification ? 'tabpanel' : undefined} id={`${uid}-design-panel`}
            className={onAddSpecification ? 'space-y-7 p-4 @min-[560px]:p-5' : undefined}
            aria-labelledby={onAddSpecification ? `${uid}-design-tab-${itemFields[activeGroup?.indexes[0] ?? safeActiveIndex].id}` : undefined}>
          <OrderItemCraftFields
            appearance={onAddSpecification ? 'plain' : 'divided'}
            hideRoute={Boolean(onPurposeChange)}
            uid={uid}
            item={item}
            title={onAddSpecification ? '工艺' : `工艺 · 第 ${safeActiveIndex + 1} 款`}
            paperKey={paperKey}
            paperOptions={paperOptions}
            foilOptions={foilOptions}
            disabled={disabled}
            itemErrors={itemErrors}
            onRouteChange={onRouteChange}
            onLaminationChange={onLaminationChange}
            onPrintFoilModeChange={onPrintFoilModeChange}
            onFoilSidesChange={onFoilSidesChange}
            onBackFoilToggle={onBackFoilToggle}
            onFoilTechniqueChange={onFoilTechniqueChange}
          />
          <OrderItemMaterialFields
            appearance={onAddSpecification ? 'plain' : 'divided'}
            uid={uid}
            item={item}
            disabled={disabled}
            itemErrors={itemErrors}
            materialExtras={materialExtras}
            hideSpecification={Boolean(onAddSpecification)}
            paperKey={paperKey}
            paperOptions={paperOptions}
            weightOptions={weightOptions}
            specificationOptions={specificationOptions}
            allowManualWeight={allowManualWeight}
            allowCustomSize={allowCustomSize}
            onPaperChange={onPaperChange}
            onWeightChange={onWeightChange}
            onSpecificationChange={onSpecificationChange}
            onCustomSizeChange={onCustomSizeChange}
          />

          <div data-slot="order-specification-section" className={onAddSpecification ? 'space-y-5 rounded-xl bg-muted/50 p-3 @min-[560px]:p-4' : undefined}>
          {onAddSpecification ? <OrderSpecificationTabs id={`${uid}-spec`}
            indexes={activeGroup?.indexes ?? []} items={items} itemFields={itemFields}
            activeIndex={safeActiveIndex} errors={fieldErrors} disabled={disabled} removeRef={removeButtonRef}
            onSelect={(index) => { cancelIssueFocus(); onActiveIndexChange(index); }}
            onAdd={onAddSpecification}
            onRemove={() => { cancelIssueFocus(); restoreDeleteFocusRef.current = true; onRemove(safeActiveIndex); }}
          /> : null}
          <div role={onAddSpecification ? 'tabpanel' : undefined} id={`${uid}-spec-panel`}
            className={onAddSpecification ? 'space-y-5' : undefined}
            aria-labelledby={onAddSpecification ? `${uid}-spec-tab-${field.id}` : undefined}>
            {onAddSpecification ? <OrderItemSpecificationFields
              uid={uid} item={item} disabled={disabled} itemErrors={itemErrors}
              specificationOptions={specificationOptions} allowCustomSize={allowCustomSize}
              onSpecificationChange={onSpecificationChange} onCustomSizeChange={onCustomSizeChange}
            /> : null}
          <Group title="数量与包装" appearance={onAddSpecification ? 'plain' : 'divided'}>
            <div className="mb-5">
              <PillPicker
                id={`${uid}-packaging-type`}
                label="包装类型"
                value={packagingType(packaging.mode)}
                options={[
                  { value: 'BAG', label: '入袋' },
                  { value: 'UNPACKED', label: '不包装' },
                  { value: 'BOX', label: '装盒' },
                ]}
                disabled={disabled}
                onChange={(type) =>
                  onPackagingModeChange(
                    packagingModeFor(
                      type as PackagingType,
                      isMixedPackaging(packaging.mode),
                      packagingBoxType(packaging.mode) ?? 'RED_CARD',
                    ),
                  )
                }
              />
              {packagingType(packaging.mode) === 'BOX' ? (
                <div className="mt-4">
                  <PillPicker
                    id={`${uid}-box-type`}
                    label="盒子"
                    value={packagingBoxType(packaging.mode) ?? 'RED_CARD'}
                    options={Object.entries(PACKAGING_BOXES).map(([value, box]) => ({
                      value,
                      label: `${box.label} · 最多 ${box.capacity} 个/盒`,
                    }))}
                    disabled={disabled}
                    onChange={(box) =>
                      onPackagingModeChange(
                        packagingModeFor(
                          'BOX',
                          isMixedPackaging(packaging.mode),
                          box as PackagingBoxType,
                        ),
                      )
                    }
                  />
                </div>
              ) : null}
            </div>
            {packaging.scopeLabel ? <p className="mb-3 text-xs text-muted-foreground">{packaging.scopeLabel}</p> : null}
            <div className="grid grid-cols-1 gap-3.5 @min-[560px]:grid-cols-2">
              <OrderItemQuantityField
                uid={uid}
                item={item}
                disabled={disabled}
                itemErrors={itemErrors}
                onQuantityChange={onQuantityChange}
              />
              {packagingType(packaging.mode) !== 'UNPACKED' ? (
                <div>
                  <FieldLabel htmlFor={`${uid}-units-per-bag`} required>
                    {packagingType(packaging.mode) === 'BOX' ? '每盒数量' : '每包数量'}
                  </FieldLabel>
                  <Input
                    id={`${uid}-units-per-bag`}
                    type="number"
                    min={1}
                    max={packagingCapacity(packaging.mode) ?? undefined}
                    step={1}
                    required
                    aria-required="true"
                    aria-invalid={Boolean(packaging.error || fieldErrors?.packaging)}
                    aria-describedby={`${uid}-packaging-message`}
                    disabled={disabled}
                    value={packaging.unitsPerBag || ''}
                    className="h-10"
                    onChange={(event) => onUnitsPerBagChange(Number(event.target.value) || 0)}
                  />
                  <FieldError
                    id={`${uid}-packaging-message`}
                    reservedLines={2}
                    hint={
                      packaging.bagCount !== null
                        ? `共 ${packaging.bagCount.toLocaleString('zh-CN')} ${packagingType(packaging.mode) === 'BOX' ? '盒' : '包'}`
                        : undefined
                    }
                  >
                    {packaging.error ?? fieldErrors?.packaging}
                  </FieldError>
                </div>
              ) : (
                <div className="flex items-center text-sm text-muted-foreground">
                  包装费 ¥0.00
                </div>
              )}
            </div>
            {packagingType(packaging.mode) !== 'UNPACKED' ? (
              <div className="mt-5">
                <PillPicker
                  id={`${uid}-packaging-mode`}
                  label="包装方式"
                  value={isMixedPackaging(packaging.mode) ? 'MIXED_STYLE' : 'SINGLE_STYLE'}
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
                  onChange={(mode) =>
                    onPackagingModeChange(
                      packagingModeFor(
                        packagingType(packaging.mode),
                        mode === 'MIXED_STYLE',
                        packagingBoxType(packaging.mode) ?? 'RED_CARD',
                      ),
                    )
                  }
                />
                {onAddSpecification && itemFields.length > 1 && !isMixedPackaging(packaging.mode) ? <p className="mt-2 text-xs text-muted-foreground">混装范围：本工单全部规格</p> : null}
                {itemFields.length < 2 ? (
                  <p className="mt-2 text-xs text-muted-foreground">{onAddSpecification ? '混装需至少 2 个规格明细' : '混装需至少 2 款'}</p>
                ) : null}
              </div>
            ) : null}
          </Group>

          </div>
          </div>

          <OrderDesignFilesSection itemNumber={designNumber} queue={queue} disabled={disabled}
            required={designImageRequired} grouped={Boolean(onAddSpecification)}
            imageError={(imageFileError?.fieldId === field.id ? imageFileError.message : undefined) ?? itemErrors?.designImage}
            cdrError={cdrFileError?.fieldId === field.id ? cdrFileError.message : undefined}
            onImage={(file) => putFile(file, DesignFileType.IMAGE)}
            onCdrFiles={appendCdrFiles} onChange={onPendingDesignsChange}
          />

          {packagingExtras || pricingExtras ? <Group title="收费与其他要求" appearance={onAddSpecification ? 'plain' : 'divided'}>
            {onAddSpecification ? <p className="mb-4 text-sm text-muted-foreground">当前规格：{item.specification || '待选规格'} · {item.quantity} 个</p> : null}
            <div className="space-y-5">
              {packagingExtras}
              {pricingExtras}
            </div>
          </Group> : null}
          </div>
          </div>
          <div className={onAddSpecification ? 'space-y-6 rounded-xl border bg-card p-4 @min-[560px]:p-5' : undefined}>
          <Group title="收货" appearance={onAddSpecification ? 'plain' : 'divided'}>
            {shippingExtras}
            <ReceiverAddressPasteField
              id={`${uid}-receiver-address-paste`}
              labelElement={
                <FieldLabel htmlFor={`${uid}-receiver-address-paste`} required>
                  收货地址
                </FieldLabel>
              }
              value={values.receiverAddress}
              required
              disabled={disabled}
              invalid={Boolean(fieldErrors?.receiverAddress)}
              describedBy={
                fieldErrors?.receiverAddress
                  ? `${uid}-receiver-address-message`
                  : undefined
              }
              onPaste={onReceiverAddressPaste}
              onChange={(value) => onReceiverAddressChange(value)}
              after={
                <FieldError id={`${uid}-receiver-address-message`} reservedLines={1}>
                  {fieldErrors?.receiverAddress}
                </FieldError>
              }
            >
              <OrderReceiverContactFields
                key={`${uid}-contacts-${values.receiverAddress}`}
                idPrefix={uid}
                receiverName={values.receiverName || parsedReceiver.receiverName}
                receiverPhone={receiverPhoneInitialValue}
                nameRequired={receiverNameRequired}
                phoneRequired={receiverPhoneRequired}
                reserveErrorSpace
                disabled={disabled}
                errors={fieldErrors}
                onNameChange={onReceiverNameChange}
                onPhoneChange={onReceiverPhoneChange}
              />
            </ReceiverAddressPasteField>

            {afterShipping}

            <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-1 text-sm font-semibold has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60">
              <Checkbox
                checked={values.isSfCollect ?? false}
                disabled={disabled}
                aria-label="顺丰到付（本单不计快递费）"
                onCheckedChange={onSfCollectChange}
              />
              顺丰到付（本单不计快递费）
            </label>
          </Group>
          {orderPackagingExtras}
          {footerExtras}
          </div>

          {/* Async error summaries must not shift fields while they are being edited. */}
          {fieldErrors?.summary && fieldErrors.summary.length > 0 ? (
            <div
              role="alert"
              data-slot="order-form-errors"
              tabIndex={-1}
              className="mt-5 rounded-xl border border-destructive bg-destructive/5 px-4 py-3.5 text-destructive"
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
        </div>

        <StickyOrderFormRail rail={rail} />
      </div>
    </div>
  );
}

function useOrderFormFocus(itemCount: number) {
  const rootRef = useRef<HTMLDivElement>(null);
  const handledErrorFocusRequestRef = useRef(0);
  const issueFocusTimerRef = useRef<number | null>(null);
  const removeButtonRef = useRef<HTMLButtonElement>(null);
  const styleNavRef = useRef<HTMLDivElement>(null);
  const restoreDeleteFocusRef = useRef(false);

  const cancelIssueFocus = useCallback(() => {
    if (issueFocusTimerRef.current !== null) {
      window.clearTimeout(issueFocusTimerRef.current);
      issueFocusTimerRef.current = null;
    }
  }, []);

  useEffect(() => cancelIssueFocus, [cancelIssueFocus]);

  useLayoutEffect(() => {
    if (!restoreDeleteFocusRef.current) return;
    restoreDeleteFocusRef.current = false;
    const target =
      removeButtonRef.current ??
      styleNavRef.current?.querySelector<HTMLButtonElement>(
        '[aria-selected="true"], [aria-pressed="true"]',
      );
    target?.focus({ preventScroll: true });
  }, [itemCount]);

  return { rootRef, handledErrorFocusRequestRef, issueFocusTimerRef, removeButtonRef,
    styleNavRef, restoreDeleteFocusRef, cancelIssueFocus };
}
