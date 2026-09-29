import { InboxComponent } from '@gitroom/frontend/components/inbox/inbox.component';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'oksocial 互动',
  description: '',
};
export default async function Index() {
  return <InboxComponent />;
}
