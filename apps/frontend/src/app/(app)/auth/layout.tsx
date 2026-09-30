import { getT } from '@gitroom/react/translation/get.translation.service.backend';

export const dynamic = 'force-dynamic';
import { ReactNode } from 'react';
import loadDynamic from 'next/dynamic';
import { LogoTextComponent } from '@gitroom/frontend/components/ui/logo-text.component';
import { MantineWrapper } from '@gitroom/react/helpers/mantine.wrapper';
import { Toaster } from '@gitroom/react/toaster/toaster';
const ReturnUrlComponent = loadDynamic(() => import('./return.url.component'));
export default async function AuthLayout({
  children,
}: {
  children: ReactNode;
}) {
  const t = await getT();

  return (
    <MantineWrapper>
      <Toaster />
      <div className="bg-newBgColorInner text-textColor flex flex-1 p-[12px] lg:p-[16px] gap-[16px] min-h-screen w-screen">
        <ReturnUrlComponent />
        {/* okchat-style split: a brand panel with the pitch, the form on white */}
        <aside className="auth-panel relative hidden lg:flex w-[46%] max-w-[680px] min-h-[calc(100vh-32px)] rounded-[20px] overflow-hidden flex-col justify-between p-[40px] text-white">
          <div className="flex items-center justify-between">
            <span className="auth-chip font-mono tracking-[0.12em] uppercase">
              <span aria-hidden="true" className="w-[6px] h-[6px] rounded-full bg-white" />
              oksocial · {t('auth_panel_tag', '社交账号运营台')}
            </span>
            <span className="auth-chip">
              <span aria-hidden="true" className="w-[6px] h-[6px] rounded-full bg-[#4ade80]" />
              {t('auth_panel_live', '账号在线')}
            </span>
          </div>
          <div className="flex flex-col gap-[28px]">
            <h2 className="text-[44px] xl:text-[52px] font-[800] leading-[1.18] tracking-[-0.01em]">
              {t('auth_pitch_line1', '一个控制台，')}
              <br />
              <span className="ps-[1em]">{t('auth_pitch_line2', '运营你所有的社交账号。')}</span>
            </h2>
            <ul className="flex flex-wrap gap-[8px]" aria-label={t('auth_pitch_features', '主要功能')}>
              {[
                t('auth_chip_1', '小红书 · 抖音 · 微博 · X 扫码接入'),
                t('auth_chip_2', '定时发布与日历'),
                t('auth_chip_3', '评论私信统一回复'),
                t('auth_chip_4', '竞品监控 · 一键复刻'),
                t('auth_chip_5', '团队审核'),
              ].map((chip) => (
                <li key={chip} className="auth-chip">
                  {chip}
                </li>
              ))}
            </ul>
          </div>
        </aside>
        <main className="flex-1 flex flex-col items-center py-[40px] px-[8px] sm:px-[20px]">
          <div className="w-full max-w-[420px] my-auto flex flex-col gap-[28px]">
            <div className="text-textColor">
              <LogoTextComponent />
            </div>
            <div className="flex">{children}</div>
          </div>
          <p className="mt-[24px] text-center text-[12px] text-textItemBlur">
            <a
              href="https://github.com/Conn-Ho/oksocial"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-textColor"
            >
              {t('source_code', '源代码')}
            </a>
          </p>
        </main>
      </div>
    </MantineWrapper>
  );
}
