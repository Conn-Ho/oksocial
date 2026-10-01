import { UsageComponent } from '@gitroom/frontend/components/usage/usage.component';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('page_title_usage', 'oksocial 用量与套餐'),
    description: '',
  };
}
export default async function Index() {
  return <UsageComponent />;
}
