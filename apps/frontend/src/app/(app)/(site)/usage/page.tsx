import { UsageComponent } from '@gitroom/frontend/components/usage/usage.component';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'oksocial 用量与套餐',
  description: '',
};
export default async function Index() {
  return <UsageComponent />;
}
