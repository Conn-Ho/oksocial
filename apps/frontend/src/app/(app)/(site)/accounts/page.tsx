import { AccountsComponent } from '@gitroom/frontend/components/accounts/accounts.component';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('page_title_accounts', 'oksocial 账号'),
    description: '',
  };
}
export default async function Index() {
  return <AccountsComponent />;
}
