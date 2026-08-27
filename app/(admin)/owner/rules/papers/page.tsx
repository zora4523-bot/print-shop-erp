import {
  MaterialCatalogList,
  type MaterialCatalogListProps,
} from '@/components/business/rules/catalog/MaterialCatalogPages';
import { MaterialCategory } from '@/generated/prisma/enums';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';

export const metadata = {
  title: '纸张 · 规则配置中心',
};

type PageProps = Pick<MaterialCatalogListProps, 'searchParams'>;

export default function PapersPage(props: PageProps) {
  return MaterialCatalogList({
    ...props,
    routeBase: RULE_CENTER_HREFS.papers,
    category: MaterialCategory.PAPER,
  });
}
