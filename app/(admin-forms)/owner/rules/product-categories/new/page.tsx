import { readSupplementContext } from '@/lib/form-drafts/return-context';
import { NewProductCategoryCatalogItem } from '@/components/business/rules/catalog/ProductCategoryCatalogPages';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';

export const metadata = {
  title: '新建产品结构分类 · 规则配置中心',
};

export default async function NewProductCategoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = readSupplementContext(await searchParams);
  return NewProductCategoryCatalogItem({
    supplement: context?.entityType === 'CATEGORY' ? context : null,
    routeBase: RULE_CENTER_HREFS.productCategories,
  });
}
