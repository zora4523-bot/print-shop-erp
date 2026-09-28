import { z } from 'zod';

export const FORM_DRAFT_TTL = 24 * 60 * 60 * 1000;
export const FORM_DRAFT_LIMIT = 8;
export const FORM_DRAFT_PREFIX = 'erp:form-draft:v1:';
export const formKindSchema = z.enum(['purchase-new', 'bom-new']);
export type FormKind = z.infer<typeof formKindSchema>;
export const FORM_PATHS = {
  'purchase-new': '/owner/purchases/new',
  'bom-new': '/owner/boms/new',
} as const;

const id = z.string().max(128);
const numberText = z.string().max(40);
const remark = z.string().max(2000);
export const purchaseDraftSchema = z.object({
  supplierPartyId: id, materialId: id,
  quantity: numberText, unitCost: numberText,
  expectedDate: z.string().max(10), remark,
}).strict();
export const bomDraftSchema = z.object({
  targetType: z.enum(['PRODUCT', 'CATEGORY', 'BLANK']),
  productId: id, categoryNodeId: id,
  blankPaperMaterialId: id, blankSpecificationKey: id,
  name: z.string().max(200), version: numberText, baseQuantity: numberText,
  rows: z.array(z.object({
    rowId: z.uuid(), materialId: id, quantity: numberText, remark,
  }).strict()).min(1).max(20),
}).strict().refine((value) => new Set(value.rows.map((row) => row.rowId)).size === value.rows.length);
type PurchaseDraft = z.infer<typeof purchaseDraftSchema>;
export type BomDraft = z.infer<typeof bomDraftSchema>;
export type FormDraftPayload = PurchaseDraft | BomDraft;

export const creationIdentitySchema = z.object({ draftId: z.uuid(), clientRequestId: z.uuid() }).strict();
export type CreationIdentity = z.infer<typeof creationIdentitySchema>;
export type FormDraftContext = CreationIdentity & {
  actorId: string;
  sessionScope: string | null;
  kind: FormKind;
};

export const supplementSchema = z.object({
  origin: formKindSchema,
  draftId: z.uuid(),
  nonce: z.uuid(),
  entityType: z.enum(['MATERIAL', 'SUPPLIER', 'CATEGORY']),
  target: z.string().max(64),
}).strict().refine((context) => {
  if (context.origin === 'purchase-new') {
    return (context.entityType === 'SUPPLIER' && context.target === 'supplierPartyId') ||
      (context.entityType === 'MATERIAL' && context.target === 'materialId');
  }
  return (context.entityType === 'CATEGORY' && context.target === 'categoryNodeId') ||
    (context.entityType === 'MATERIAL' && /^row:[0-9a-f-]{36}$/i.test(context.target) && z.uuid().safeParse(context.target.slice(4)).success);
});
export type SupplementContext = z.infer<typeof supplementSchema>;

const envelope = z.object({
  schemaVersion: z.literal(1),
  actorId: z.string().min(1).max(128),
  sessionScope: z.uuid().nullable(),
  draftId: z.uuid(), clientRequestId: z.uuid(),
  savedAt: z.number().int().nonnegative(),
  supplement: supplementSchema.nullable(),
});
const storedDraftSchema = z.discriminatedUnion('kind', [
  envelope.extend({ kind: z.literal('purchase-new'), payload: purchaseDraftSchema }),
  envelope.extend({ kind: z.literal('bom-new'), payload: bomDraftSchema }),
]);
export type StoredDraft = z.infer<typeof storedDraftSchema>;

export function draftStorageKey(context: Pick<FormDraftContext, 'actorId' | 'kind' | 'draftId'>) {
  return `${FORM_DRAFT_PREFIX}${encodeURIComponent(context.actorId)}:${context.kind}:${context.draftId}`;
}

export function parseStoredDraft(raw: string, actorId: string, now = Date.now()): StoredDraft | null {
  if (raw.length > 80_000) return null;
  try {
    const parsed = storedDraftSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.actorId !== actorId) return null;
    const draft = parsed.data;
    if (draft.savedAt > now + 60_000 || now - draft.savedAt > FORM_DRAFT_TTL) return null;
    if (draft.supplement && (draft.supplement.draftId !== draft.draftId || draft.supplement.origin !== draft.kind)) return null;
    return draft;
  } catch { return null; }
}

export function emptyPurchaseDraft(supplierPartyId = ''): PurchaseDraft {
  return { supplierPartyId, materialId: '', quantity: '', unitCost: '', expectedDate: '', remark: '' };
}

export function emptyBomDraft(rowId: string): BomDraft {
  return {
    targetType: 'BLANK', productId: '', categoryNodeId: '', blankPaperMaterialId: '', blankSpecificationKey: '',
    name: '', version: '1', baseQuantity: '1', rows: [{ rowId, materialId: '', quantity: '', remark: '' }],
  };
}
