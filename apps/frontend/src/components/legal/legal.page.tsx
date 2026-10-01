import { ReactNode } from 'react';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';

export type LegalSection = { heading: string; body: ReactNode };

/** 服务条款 / 隐私政策: a plain, readable document page (public, no login). */
export const LegalPage = async ({
  title,
  updated,
  intro,
  sections,
}: {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
}) => {
  const t = await getT();
  return (
    <main className="min-h-screen bg-[#0E0E0E] text-white/90 px-[16px] py-[48px]">
      <article className="mx-auto max-w-[760px] flex flex-col gap-[28px] leading-[1.8] text-[15px]">
        <header className="flex flex-col gap-[8px]">
          <a href="/" className="text-[14px] text-white/50 hover:text-white focus-visible:text-white w-fit">
            ← oksocial
          </a>
          <h1 className="text-[32px] font-semibold text-white">{title}</h1>
          <p className="text-[13px] text-white/50">
            {t('legal_updated', '最近更新：{{date}}', { date: updated, interpolation: { escapeValue: false } })}
          </p>
          <p>{intro}</p>
        </header>
        {sections.map((s) => (
          <section key={s.heading} className="flex flex-col gap-[8px]">
            <h2 className="text-[20px] font-semibold text-white">{s.heading}</h2>
            <div className="flex flex-col gap-[8px] text-white/80">{s.body}</div>
          </section>
        ))}
        <footer className="border-t border-white/10 pt-[20px] text-[13px] text-white/50">
          {t('legal_contact', '对这些内容有疑问，请发邮件到')}{' '}
          <a className="underline" href="mailto:hello@oksocial.online">hello@oksocial.online</a>
          {t('legal_contact_end', '。')}
        </footer>
      </article>
    </main>
  );
};
