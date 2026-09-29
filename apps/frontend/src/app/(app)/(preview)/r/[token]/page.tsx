import { PublicReport } from '@gitroom/frontend/components/reports/public.report';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'oksocial 运营报告',
  description: '',
  robots: { index: false, follow: false },
};
export default async function SharedReport(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  // read at request time: the image is built without environment-specific URLs
  return <PublicReport backendUrl={process.env.NEXT_PUBLIC_BACKEND_URL || '/api'} token={token} />;
}
