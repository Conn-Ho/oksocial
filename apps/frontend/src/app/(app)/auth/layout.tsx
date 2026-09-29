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
      <div className="bg-[#0E0E0E] flex flex-1 p-[12px] gap-[12px] min-h-screen w-screen text-white">
        {/*<style>{`html, body {overflow-x: hidden;}`}</style>*/}
        <ReturnUrlComponent />
        <div className="flex flex-col py-[40px] px-[20px] flex-1 lg:w-[600px] lg:flex-none rounded-[12px] text-white p-[12px] bg-[#1A1919]">
          <div className="w-full max-w-[440px] mx-auto justify-center gap-[20px] h-full flex flex-col text-white">
            <LogoTextComponent />
            <div className="flex">{children}</div>
          </div>
        </div>
        <div className="flex-1 hidden lg:flex flex-col justify-center px-[72px]">
          <h2 className="text-[40px] font-semibold leading-[1.25] max-w-[560px]">
            {t('auth_pitch_title', '一个控制台，运营你所有的社交账号')}
          </h2>
          <ul className="mt-[32px] flex flex-col gap-[18px] text-[17px] text-white/80 max-w-[520px]">
            {[
              t('auth_pitch_1', '小红书、抖音、微博、X 扫码接入，每个账号独立浏览器与出口 IP'),
              t('auth_pitch_2', '定时发布、日历、草稿、Excel 批量导入'),
              t('auth_pitch_3', '团队角色与发布审核，内容运营提交、主管把关'),
              t('auth_pitch_4', '登录保活：账号掉线自动提醒，一键重新扫码'),
            ].map((line) => (
              <li key={line} className="flex gap-[12px]">
                <span aria-hidden="true" className="mt-[9px] w-[8px] h-[8px] rounded-full bg-[#612BD3] shrink-0" />
                {line}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </MantineWrapper>
  );
}
