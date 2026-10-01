import { ApprovalsComponent } from '@gitroom/frontend/components/approvals/approvals.component';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('page_title_approvals', 'oksocial 审核'),
    description: '',
  };
}
export default async function Index() {
  return <ApprovalsComponent />;
}
