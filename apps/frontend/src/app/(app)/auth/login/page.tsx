export const dynamic = 'force-dynamic';
import { Login } from '@gitroom/frontend/components/auth/login';
import { Metadata } from 'next';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('page_title_login', 'oksocial 登录'),
    description: '',
  };
}
export default async function Auth() {
  return <Login />;
}
