export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';
import { Activate } from '@gitroom/frontend/components/auth/activate';
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('page_title_activate', 'oksocial 激活账号'),
    description: '',
  };
}
export default async function Auth() {
  return <Activate />;
}
