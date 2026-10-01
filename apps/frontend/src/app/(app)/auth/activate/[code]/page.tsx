export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { AfterActivate } from '@gitroom/frontend/components/auth/after.activate';
export const metadata: Metadata = {
  title: 'oksocial 激活账号',
  description: '',
};
export default async function Auth() {
  return <AfterActivate />;
}
