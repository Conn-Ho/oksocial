export const dynamic = 'force-dynamic';
import { Login } from '@gitroom/frontend/components/auth/login';
import { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'oksocial 登录',
  description: '',
};
export default async function Auth() {
  return <Login />;
}
