import { MonitorComponent } from '@gitroom/frontend/components/monitor/monitor.component';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('page_title_monitor', 'oksocial 监控'),
    description: '',
  };
}
export default async function Index() {
  return <MonitorComponent />;
}
