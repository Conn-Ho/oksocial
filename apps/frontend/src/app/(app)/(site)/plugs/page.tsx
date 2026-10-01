import { Plugs } from '@gitroom/frontend/components/plugs/plugs';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('page_title_plugs', 'oksocial 插件'),
    description: '',
  };
}
export default async function Index() {
  return <Plugs />;
}
