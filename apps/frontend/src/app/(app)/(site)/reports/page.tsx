import { ReportsComponent } from '@gitroom/frontend/components/reports/reports.component';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'oksocial 报告',
  description: '',
};
export default async function Index() {
  return <ReportsComponent />;
}
