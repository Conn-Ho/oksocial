import { MonitorComponent } from '@gitroom/frontend/components/monitor/monitor.component';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'oksocial 监控',
  description: '',
};
export default async function Index() {
  return <MonitorComponent />;
}
