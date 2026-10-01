import { NotificationCenter } from '@gitroom/frontend/components/notifications/notification.center';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('page_title_notifications', 'oksocial 通知中心'),
    description: '',
  };
}
export default async function Index() {
  return <NotificationCenter />;
}
