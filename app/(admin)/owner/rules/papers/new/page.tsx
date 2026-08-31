import { NewMaterialCatalogItem } from '@/components/business/rules/catalog/MaterialCatalogPages';
import { MaterialCategory } from '@/generated/prisma/enums';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';

export const metadata = {
  title: '新建纸张 · 规则配置中心',
};

export default function NewPaperPage() {
  return NewMaterialCatalogItem({
    routeBase: RULE_CENTER_HREFS.papers,
    categoryScope: MaterialCategory.PAPER,
  });
}
