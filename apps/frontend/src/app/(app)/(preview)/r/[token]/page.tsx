import { PublicReport } from '@gitroom/frontend/components/reports/public.report';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('page_title_report', 'oksocial 运营报告'),
    description: '',
    robots: { index: false, follow: false },
  };
}
export default async function SharedReport(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  // read at request time: the image is built without environment-specific URLs
  return <PublicReport backendUrl={process.env.NEXT_PUBLIC_BACKEND_URL || '/api'} token={token} />;
}
