import { AutomationsComponent } from '@gitroom/frontend/components/automations/automations.component';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'oksocial 自动化',
  description: '',
};
export default async function Index() {
  return <AutomationsComponent />;
}
