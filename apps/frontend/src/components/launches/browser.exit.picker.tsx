'use client';

import React, { FC, useState } from 'react';
import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Button } from '@gitroom/react/form/button';
import { useBrowserProxies } from '@gitroom/frontend/components/settings/browser.proxies.component';

// '' stands for no exit IP: the server's own
const NO_PROXY = '';

/**
 * Before an overseas account's first login: which exit IP (出口代理) its browser starts behind, so the
 * platform sees it from that IP from the first page on. Defaults to the team's first one.
 */
export const BrowserExitPicker: FC<{
  onStart: (proxyId?: string) => void;
}> = ({ onStart }) => {
  const t = useT();
  const router = useRouter();
  const modals = useModals();
  const { data: proxies, isLoading } = useBrowserProxies();
  const [choice, setChoice] = useState<string | null>(null);
  const selected = choice ?? proxies?.[0]?.id ?? NO_PROXY;

  const addProxy = () => {
    modals.closeCurrent();
    router.push('/settings?tab=proxies');
  };

  if (isLoading) {
    return <p className="text-[14px] text-textColor/60">{t('browser_exit_loading', '正在读取出口 IP…')}</p>;
  }

  const options = [
    ...(proxies ?? []).map((p) => ({
      id: p.id,
      title: p.name,
      detail: t('browser_exit_proxy_detail', '{{host}} · {{n}} 个账号在用', {
        host: p.host.replace(/^\w+:\/\//, ''),
        n: p.slots,
        interpolation: { escapeValue: false },
      }),
    })),
    {
      id: NO_PROXY,
      title: t('browser_exit_none_option', '不用出口 IP'),
      detail: t('browser_exit_none_detail', '直接用 oksocial 服务器的 IP（香港机房）'),
    },
  ];

  return (
    <div className="flex flex-col gap-[16px] w-full">
      <div className="flex flex-col gap-[6px]">
        <div className="text-[16px] font-[600]">{t('browser_exit_title', '先选出口 IP')}</div>
        <p className="text-[14px] text-textColor/80">
          {t(
            'browser_exit_intro',
            '这个账号的浏览器会从第一页起走这个 IP，之后发帖、互动也都走它。建议和你平时用这个账号的地区一致。'
          )}
        </p>
      </div>
      {!proxies?.length && (
        <p className="text-[13px] rounded-[10px] border border-newBorder bg-newTableHeader px-[14px] py-[10px]">
          {t('browser_exit_empty', '团队还没有出口 IP。可以先到「设置 → 出口代理」添加一个，再回来登录。')}
        </p>
      )}
      <div role="radiogroup" aria-label={t('browser_exit_title', '先选出口 IP')} className="flex flex-col gap-[8px]">
        {options.map((o) => (
          <button
            key={o.id || 'none'}
            type="button"
            role="radio"
            aria-checked={selected === o.id}
            onClick={() => setChoice(o.id)}
            className={clsx(
              'flex flex-col items-start gap-[2px] rounded-[10px] border px-[14px] py-[10px] text-start transition-colors',
              selected === o.id ? 'border-btnPrimary bg-boxHover' : 'border-newBorder hover:bg-boxHover'
            )}
          >
            <span className="text-[14px] font-[600]">{o.title}</span>
            <span className="text-[12px] text-textColor/60">{o.detail}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-[12px]">
        {!proxies?.length && (
          <Button secondary={true} onClick={addProxy}>
            {t('browser_exit_add', '去添加出口 IP')}
          </Button>
        )}
        <Button onClick={() => onStart(selected || undefined)}>{t('browser_exit_start', '开始登录')}</Button>
        <Button secondary={true} onClick={() => modals.closeCurrent()}>
          {t('cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  );
};
