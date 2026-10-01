import { OkchatConnect } from '@gitroom/frontend/components/okchat/okchat.connect';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('page_title_okchat_connect', '把账号接到 okchat'),
    description: '',
  };
}
export default async function Index() {
  return <OkchatConnect />;
}
