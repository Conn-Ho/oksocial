import { ReportsComponent } from '@gitroom/frontend/components/reports/reports.component';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('page_title_reports', 'oksocial 报告'),
    description: '',
  };
}
export default async function Index() {
  return <ReportsComponent />;
}
