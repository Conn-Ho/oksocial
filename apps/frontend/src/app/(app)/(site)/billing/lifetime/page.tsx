import { LifetimeDeal } from '@gitroom/frontend/components/billing/lifetime.deal';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('page_title_lifetime', 'oksocial 终身套餐'),
    description: '',
  };
}
export default async function Page() {
  return <LifetimeDeal />;
}
