'use client';

import React, { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { BrowserLoginModal } from '@gitroom/frontend/components/launches/browser.login.modal';
import { InboxNotice, useInboxNotices } from '@gitroom/frontend/components/inbox/inbox.hooks';

// Platforms whose notice is fixed by logging in to their second site (小红书网页版).
const WEB_LOGIN = new Set(['xiaohongshu']);

/** Accounts whose messages can't all be read right now, each with the way to fix it. */
export const InboxNotices: FC<{ canFix: boolean; onFixed: () => void }> = ({ canFix, onFixed }) => {
  const t = useT();
  const modal = useModals();
  const { data, mutate } = useInboxNotices();
  if (!data?.length) {
    return null;
  }
  const fix = (n: InboxNotice) =>
    modal.openModal({
      title: t('browser_web_title', '登录网页版：{{name}}', { name: n.name }),
      withCloseButton: true,
      classNames: { modal: 'bg-transparent text-textColor w-[980px] max-w-[95vw]' },
      children: (
        <BrowserLoginModal
          identifier={n.providerIdentifier}
          name={n.name}
          integrationId={n.integrationId}
          mode="web"
          onConnected={() => {
            mutate();
            onFixed();
          }}
        />
      ),
    });
  return (
    <div className="flex flex-col gap-[8px] px-[16px] md:px-[24px] pb-[12px]" role="status">
      {data.map((n) => (
        <div
          key={n.integrationId}
          className="flex flex-wrap items-center gap-[12px] rounded-[8px] border border-amber-500/40 bg-amber-500/10 px-[14px] py-[10px] text-[13px]"
        >
          <span className="font-[600]">{n.name}</span>
          <span className="flex-1 min-w-[200px] text-textColor/80">{n.notice}</span>
          {canFix && WEB_LOGIN.has(n.providerIdentifier) && (
            <button
              type="button"
              className="rounded-[6px] bg-btnPrimary text-white px-[12px] h-[30px] hover:opacity-90 focus-visible:ring-2 focus-visible:ring-btnPrimary"
              onClick={() => fix(n)}
            >
              {t('inbox_notice_fix_web', '扫码登录网页版')}
            </button>
          )}
        </div>
      ))}
    </div>
  );
};
