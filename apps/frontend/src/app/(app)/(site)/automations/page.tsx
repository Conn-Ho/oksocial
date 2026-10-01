import { AutomationsComponent } from '@gitroom/frontend/components/automations/automations.component';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('page_title_automations', 'oksocial 自动化'),
    description: '',
  };
}
export default async function Index() {
  return <AutomationsComponent />;
}
