import { ApprovalsComponent } from '@gitroom/frontend/components/approvals/approvals.component';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'oksocial 审核',
  description: '',
};
export default async function Index() {
  return <ApprovalsComponent />;
}
