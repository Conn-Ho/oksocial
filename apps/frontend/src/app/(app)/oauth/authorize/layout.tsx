import { Metadata } from 'next';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';
import { ReactNode } from 'react';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('page_title_oauth_authorize', '授权应用'),
  };
}

export default async function OAuthLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="bg-[#0B0A0A] flex flex-1 min-h-screen w-screen">
      {children}
    </div>
  );
}
