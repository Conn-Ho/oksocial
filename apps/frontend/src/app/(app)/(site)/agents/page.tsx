import { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'oksocial AI 助手',
  description: '',
};

export default async function Page() {
  return redirect('/agents/new');
}
