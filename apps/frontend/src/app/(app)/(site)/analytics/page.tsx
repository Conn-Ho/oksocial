export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';
import { PlatformAnalytics } from '@gitroom/frontend/components/platform-analytics/platform.analytics';
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('page_title_analytics', 'oksocial 数据分析'),
    description: '',
  };
}
export default async function Index() {
  return <PlatformAnalytics />;
}
