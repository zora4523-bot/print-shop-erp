import { FORM_PATHS, supplementSchema, type SupplementContext } from './model';

type Search = Record<string, string | string[] | undefined>;
const keys = ['origin', 'draftId', 'nonce', 'entityType', 'target'] as const;

/** Fixed business destinations only. This protocol never accepts a return URL. */
export function readSupplementContext(source: Search | FormData): SupplementContext | null {
  const values = Object.fromEntries(keys.map((key) => {
    const name = `form_${key}`;
    const raw = source instanceof FormData ? source.get(name) : source[name];
    return [key, typeof raw === 'string' ? raw : undefined];
  }));
  const parsed = supplementSchema.safeParse(values);
  return parsed.success ? parsed.data : null;
}

export function supplementParams(context: SupplementContext): Record<string, string> {
  return Object.fromEntries(keys.map((key) => [`form_${key}`, context[key]]));
}

export function supplementReturnHref(context: SupplementContext, entityId?: string): string {
  const query = new URLSearchParams(supplementParams(context));
  if (entityId) query.set('form_entityId', entityId);
  return `${FORM_PATHS[context.origin]}?${query}`;
}

export function supplementCreateHref(context: SupplementContext, manage = false): string {
  const path = context.entityType === 'SUPPLIER'
    ? (manage ? '/owner/parties' : '/owner/parties/new')
    : context.entityType === 'CATEGORY' ? '/owner/rules/product-categories/new' : '/owner/materials/new';
  const query = new URLSearchParams(supplementParams(context));
  if (context.entityType === 'SUPPLIER') query.set('type', manage ? 'suppliers' : 'SUPPLIER');
  return `${path}?${query}`;
}
