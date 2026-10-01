import { CreationComponent } from '@gitroom/frontend/components/creation/creation.component';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('page_title_create', 'oksocial AI 创作'),
    description: '',
  };
}
export default async function Index() {
  return <CreationComponent />;
}
