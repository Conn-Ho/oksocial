import { CreationComponent } from '@gitroom/frontend/components/creation/creation.component';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'oksocial AI 创作',
  description: '',
};
export default async function Index() {
  return <CreationComponent />;
}
