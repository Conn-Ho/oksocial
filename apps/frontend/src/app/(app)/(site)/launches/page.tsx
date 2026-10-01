export const dynamic = 'force-dynamic';
import { LaunchesComponent } from '@gitroom/frontend/components/launches/launches.component';
import { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'oksocial 日历',
  description: '',
};
export default async function Index() {
  return <LaunchesComponent />;
}
