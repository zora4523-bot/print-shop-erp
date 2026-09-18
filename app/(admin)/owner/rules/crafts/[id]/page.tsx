import {
  EditCraftCatalogItem,
  getCraftCatalogMetadata,
} from '@/components/business/rules/catalog/CraftCatalogPages';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export function generateMetadata(props: PageProps) {
  return getCraftCatalogMetadata(props);
}

export default function EditRuleCenterCraftPage(props: PageProps) {
  return EditCraftCatalogItem({
    ...props,
    routeBase: RULE_CENTER_HREFS.crafts,
  });
}
