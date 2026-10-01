export const dynamic = 'force-dynamic';
import { Forgot } from '@gitroom/frontend/components/auth/forgot';
import { Metadata } from 'next';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('page_title_forgot_password', 'oksocial 找回密码'),
    description: '',
  };
}
export default async function Auth() {
  return <Forgot />;
}
