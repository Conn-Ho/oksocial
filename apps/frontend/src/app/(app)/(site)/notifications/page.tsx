import { NotificationCenter } from '@gitroom/frontend/components/notifications/notification.center';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'oksocial 通知中心',
  description: '',
};
export default async function Index() {
  return <NotificationCenter />;
}
