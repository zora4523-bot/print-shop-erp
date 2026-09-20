import Decimal from 'decimal.js';
import { blankPaperFact } from '../../lib/price/blank-paper';
import { blankPriceIdentity, blankPriceIdentityFromCondition } from '../../lib/price/blank-price-identity';
import { readConfirmedHistoricalBlankPrice, type HistoricalBlankItem } from '../../lib/order/historical-blank-price';
import { planBlankBomMigration, type BlankBomMigrationInput } from '../../lib/bom/blank-target-migration';

type Paper = { id: string; name: string; specification: string | null; isActive: boolean; outOfStock: boolean };
type Book = { id: string; version: number; isActive: boolean; effectiveFrom: string; effectiveTo: string | null; notes: unknown };
type Rule = { id: string; priceBookId: string; productId: string | null; amount: string | null; isActive: boolean; kind: string; calculationType: string | null; triggerCondition: unknown };
export type BlankPricePreflightInput = {
  at: Date; papers: Paper[]; books: Book[]; rules: Rule[];
  items: HistoricalBlankItem[];
  bom: BlankBomMigrationInput;
};
function workflowStatus(notes: unknown): unknown {
  return notes && typeof notes === 'object' && 'workflow' in notes && notes.workflow && typeof notes.workflow === 'object' && 'status' in notes.workflow
    ? notes.workflow.status : null;
}
export function buildBlankPricePolicyPreflight(input: BlankPricePreflightInput) {
  const currentBooks = input.books.filter((book) => book.isActive && new Date(book.effectiveFrom) <= input.at &&
    (!book.effectiveTo || new Date(book.effectiveTo) > input.at));
  const duplicatePaperGroups = new Map<string, string[]>();
  for (const paper of input.papers) {
    const fact = blankPaperFact(paper);
    if (!fact) continue;
    const key = `${fact.paperType}:${fact.paperWeightGsm}`;
    duplicatePaperGroups.set(key, [...duplicatePaperGroups.get(key) ?? [], paper.id]);
  }
  const validRules = input.rules.map((rule) => ({ rule, identity: blankPriceIdentityFromCondition(rule.triggerCondition) }));
  const invalidRuleIds = validRules.filter(({ rule, identity }) => !identity || rule.kind !== 'BASE' || rule.calculationType !== 'PER_PIECE' ||
    rule.amount === null || !new Decimal(rule.amount).isFinite() || new Decimal(rule.amount).isNegative() || new Decimal(rule.amount).decimalPlaces() > 4).map(({ rule }) => rule.id);
  const duplicateRules = new Map<string, string[]>();
  for (const { rule, identity } of validRules) {
    if (!identity) continue;
    const key = `${rule.priceBookId}:${identity.key}`;
    duplicateRules.set(key, [...duplicateRules.get(key) ?? [], rule.id]);
  }
  const currentRules = validRules.filter(({ rule }) => currentBooks.some((book) => book.id === rule.priceBookId));
  const unavailablePaperRuleIds: string[] = [];
  const missingPaperRuleIds: string[] = [];
  const retired120RuleIds: string[] = [];
  for (const { rule, identity } of currentRules) {
    if (!identity) continue;
    const matches = input.papers.filter((paper) => {
      const fact = blankPaperFact(paper);
      return fact?.paperType === identity.paperType && fact.paperWeightGsm === identity.paperWeightGsm;
    });
    if (identity.paperWeightGsm === 120) retired120RuleIds.push(rule.id);
    if (matches.length !== 1) missingPaperRuleIds.push(rule.id);
    else if (!matches[0]!.isActive || matches[0]!.outOfStock) unavailablePaperRuleIds.push(rule.id);
  }
  const verified = input.items.filter((item) => readConfirmedHistoricalBlankPrice(item) !== null);
  const stoppedItems = input.items.filter((item) => {
    const identity = blankPriceIdentity({ paperType: item.paperType ?? '', paperWeightGsm: item.paperWeightGsm, specification: item.specification ?? '' });
    const rows = currentRules.filter((entry) => entry.identity?.key === identity?.key && entry.rule.isActive);
    return !identity || rows.length !== 1 || rows[0]!.rule.amount === null || !new Decimal(rows[0]!.rule.amount!).gt(0);
  });
  const migration = planBlankBomMigration(input.bom);
  return {
    policy: 'POSITIVE_BLANK_PRICE_V1',
    versionSelection: { currentCount: currentBooks.length, currentIds: currentBooks.map((book) => book.id),
      scheduledIds: input.books.filter((book) => book.isActive && new Date(book.effectiveFrom) > input.at).map((book) => book.id),
      draftIds: input.books.filter((book) => workflowStatus(book.notes) === 'DRAFT').map((book) => book.id) },
    prices: { totalRows: input.rules.length, currentRows: currentRules.length,
      positive: currentRules.filter(({ rule }) => rule.isActive && rule.amount !== null && new Decimal(rule.amount).gt(0)).length,
      zero: currentRules.filter(({ rule }) => rule.amount !== null && new Decimal(rule.amount).isZero()).length,
      inactive: currentRules.filter(({ rule }) => !rule.isActive).length,
      invalidRuleIds, duplicateRuleGroups: [...duplicateRules.values()].filter((ids) => ids.length > 1),
      unboundCurrentRows: currentRules.filter(({ rule }) => rule.productId === null).length,
      missingOrAmbiguousPaperRuleIds: missingPaperRuleIds, unavailablePaperRuleIds, retired120RuleIds },
    papers: { count: input.papers.length, duplicateIdentityGroups: [...duplicatePaperGroups.values()].filter((ids) => ids.length > 1) },
    historicalMaterialEvidence: { acceptedBlankItems: input.items.length, verified: verified.length,
      requireManualConfirmation: input.items.length - verified.length,
      stoppedOriginalItems: stoppedItems.length,
      stoppedItemsRequiringManualConfirmation: stoppedItems.filter((item) => !readConfirmedHistoricalBlankPrice(item)).map((item) => item.id) },
    bomMigration: { ready: migration.ready, issues: migration.issues, defaultCategoryId: migration.defaultCategoryId,
      categorySourceIds: migration.categorySourceIds, copyCount: migration.copies.length,
      proposedCopies: migration.copies.map((copy) => ({ targetId: copy.id, sourceId: copy.source.id, productIds: copy.productIds })),
      preservedTargetIds: migration.preserved },
    readyForAutomaticCutover: currentBooks.length === 1 && invalidRuleIds.length === 0 &&
      [...duplicateRules.values()].every((ids) => ids.length <= 1) && missingPaperRuleIds.length === 0 && migration.issues.length === 0,
    /** External consumers, audit JSON and historical snapshots require a separate deletion audit. */
    cleanupAuthorized: false,
  };
}
