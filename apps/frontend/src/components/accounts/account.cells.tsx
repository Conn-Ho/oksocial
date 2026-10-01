'use client';

import React, { FC } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { ACCOUNT_STATUS_LABELS, AccountStatus } from '@gitroom/helpers/utils/channel.accounts';
import { TagDot } from '@gitroom/frontend/components/launches/channel.tags.modal';
import { Account } from '@gitroom/frontend/components/accounts/accounts.hooks';

dayjs.extend(relativeTime);

const NO_PICTURE = '/no-picture.jpg';
// chips a row shows before 「+N」
const MAX_TAG_CHIPS = 2;

/** Avatar with the platform badge, the name and the @handle. */
export const AccountIdentity: FC<{ account: Account }> = ({ account }) => {
  const handle = account.display?.replace(/^@/, '');
  return (
    <div className="flex items-center gap-[10px] min-w-0">
      <span className="relative shrink-0 w-[36px] h-[36px]">
        <img
          src={account.picture || NO_PICTURE}
          alt=""
          width={36}
          height={36}
          loading="lazy"
          className={clsx('w-[36px] h-[36px] rounded-full object-cover bg-newTableHeader', account.disabled && 'opacity-50 grayscale')}
          onError={(e) => {
            const img = e.currentTarget;
            if (!img.src.endsWith(NO_PICTURE)) {
              img.src = NO_PICTURE;
            }
          }}
        />
        <img
          src={`/icons/platforms/${account.identifier}.png`}
          alt=""
          width={16}
          height={16}
          className="absolute -bottom-[2px] -end-[2px] w-[16px] h-[16px] rounded-[4px] ring-2 ring-newBgColorInner bg-newBgColorInner"
        />
      </span>
      <span className="flex flex-col min-w-0">
        <span className={clsx('text-[14px] font-[600] truncate', account.disabled && 'text-textItemBlur')}>{account.name}</span>
        {!!handle && <span className="text-[12px] text-textItemBlur truncate">@{handle}</span>}
      </span>
    </div>
  );
};

export const PlatformLabel: FC<{ identifier: string; name: string }> = ({ identifier, name }) => (
  <span className="inline-flex items-center gap-[6px] min-w-0 text-[13px]">
    <img src={`/icons/platforms/${identifier}.png`} alt="" width={16} height={16} className="w-[16px] h-[16px] rounded-[4px] shrink-0" />
    <span className="truncate">{name}</span>
  </span>
);

const STATUS_STYLE: Record<AccountStatus, { dot: string; text: string }> = {
  ok: { dot: 'bg-green-500', text: 'text-textColor' },
  refresh: { dot: 'bg-red-500', text: 'text-red-500 font-[600]' },
  disabled: { dot: 'bg-textItemBlur', text: 'text-textItemBlur' },
  paused: { dot: 'bg-amber-500', text: 'text-amber-600 font-[600]' },
  setup: { dot: 'bg-btnPrimary', text: 'text-btnPrimary font-[600]' },
};

/** 风控暂停至 HH:mm (with the day when it is not today). */
const pausedUntil = (until: string) => {
  const time = dayjs(until);
  return time.isSame(dayjs(), 'day') ? time.format('HH:mm') : time.format('MM-DD HH:mm');
};

/** The account's state in words, with what to do about it and what the browser needs fixed underneath. */
export const AccountStatusBadge: FC<{
  account: Account;
  status: AccountStatus;
  action?: { label: string; run: () => void } | null;
}> = ({ account, status, action }) => {
  const t = useT();
  const style = STATUS_STYLE[status];
  const label =
    status === 'paused' && account.browser?.brakeUntil
      ? t('account_status_paused_until', '风控暂停至 {{time}}', { time: pausedUntil(account.browser.brakeUntil) })
      : t(`account_status_${status}`, ACCOUNT_STATUS_LABELS[status]);
  const reason = status === 'paused' ? account.browser?.brakeReason : null;
  return (
    <span className="flex flex-col gap-[2px] min-w-0">
      <span
        className={clsx('inline-flex items-start gap-[6px] text-[13px] leading-[18px]', style.text)}
        {...(reason ? { 'data-tooltip-id': 'tooltip', 'data-tooltip-content': reason } : {})}
      >
        <span aria-hidden="true" className={clsx('w-[7px] h-[7px] mt-[5.5px] rounded-full shrink-0', style.dot)} />
        {label}
      </span>
      {!!account.browser?.notice && status !== 'disabled' && (
        <span className="text-[12px] text-textItemBlur line-clamp-2 break-words" title={account.browser.notice}>
          {account.browser.notice}
        </span>
      )}
      {action && (
        <button
          type="button"
          onClick={action.run}
          className="self-start inline-flex items-center gap-[2px] text-[13px] font-[600] text-btnPrimary hover:underline underline-offset-4 rounded-[4px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-btnPrimary"
        >
          {action.label}
          <span aria-hidden="true" className="rtl:rotate-180">›</span>
        </button>
      )}
    </span>
  );
};

/** 出口 IP of a browser account (the bound proxy or the server's own IP); a dash for the others. */
export const ExitIpCell: FC<{ account: Account; onBind?: () => void }> = ({ account, onBind }) => {
  const t = useT();
  if (!account.browser) {
    return (
      <span className="text-textItemBlur" aria-label={t('account_exit_ip_none', '不适用')}>
        —
      </span>
    );
  }
  const proxy = account.browser.proxy;
  const label = proxy ? proxy.name : t('account_exit_ip_server', '服务器 IP');
  const content = (
    <>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden={true} className="shrink-0">
        <path
          d="M12 21C16.9706 21 21 16.9706 21 12C21 7.02944 16.9706 3 12 3M12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3M12 21C14.5 18.5 15.5 15.5 15.5 12C15.5 8.5 14.5 5.5 12 3M12 21C9.5 18.5 8.5 15.5 8.5 12C8.5 8.5 9.5 5.5 12 3M3.5 9H20.5M3.5 15H20.5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
      <span className="truncate">{label}</span>
    </>
  );
  const tooltip = proxy ? { 'data-tooltip-id': 'tooltip', 'data-tooltip-content': proxy.host ? `${proxy.name} · ${proxy.host}` : proxy.name } : {};
  const className = clsx('inline-flex items-center gap-[6px] text-[13px] min-w-0 max-w-full', proxy ? 'text-textColor' : 'text-textItemBlur');
  if (!onBind) {
    return (
      <span className={className} {...tooltip}>
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onBind}
      aria-label={t('account_bind_exit_ip_for', '绑定出口 IP：{{name}}', { name: account.name, interpolation: { escapeValue: false } })}
      className={clsx(className, 'rounded-[6px] px-[6px] -mx-[6px] h-[28px] hover:bg-boxHover hover:text-textColor focus-visible:outline focus-visible:outline-2 focus-visible:outline-btnPrimary')}
      {...tooltip}
    >
      {content}
    </button>
  );
};

/** The tags as chips, and 添加标签 / 编辑 for who manages channels. */
export const AccountTags: FC<{ account: Account; onEdit?: () => void }> = ({ account, onEdit }) => {
  const t = useT();
  const tags = account.tags || [];
  const shown = tags.slice(0, MAX_TAG_CHIPS);
  const hidden = tags.slice(MAX_TAG_CHIPS);
  return (
    <div className="flex flex-wrap items-center gap-[4px] min-w-0">
      {shown.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex items-center gap-[5px] h-[24px] px-[7px] rounded-full bg-newTableHeader ring-1 ring-newBorder text-[12px] max-w-[120px]"
        >
          <TagDot color={tag.color} />
          <span className="truncate">{tag.name}</span>
        </span>
      ))}
      {hidden.length > 0 && (
        <span
          className="inline-flex items-center h-[24px] px-[7px] rounded-full bg-newTableHeader ring-1 ring-newBorder text-[12px] text-textItemBlur tabular-nums"
          data-tooltip-id="tooltip"
          data-tooltip-content={hidden.map((tag) => tag.name).join('、')}
        >
          +{hidden.length}
        </span>
      )}
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={
            tags.length
              ? t('account_edit_tags_for', '编辑「{{name}}」的标签', { name: account.name, interpolation: { escapeValue: false } })
              : t('account_add_tags_for', '给「{{name}}」添加标签', { name: account.name, interpolation: { escapeValue: false } })
          }
          className={clsx(
            'inline-flex items-center gap-[4px] h-[24px] rounded-full text-[12px] text-textItemBlur hover:text-textColor hover:bg-boxHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-btnPrimary',
            tags.length ? 'w-[20px] justify-center' : 'px-[8px] border border-dashed border-newBorder'
          )}
        >
          {tags.length ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden={true}>
              <path d="M4 20H8L18.5 9.5C19.6 8.4 19.6 6.6 18.5 5.5C17.4 4.4 15.6 4.4 14.5 5.5L4 16V20Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          ) : (
            <>
              <span aria-hidden="true">+</span>
              {t('channel_add_tags', '添加标签')}
            </>
          )}
        </button>
      ) : (
        !tags.length && <span className="text-textItemBlur text-[13px]">—</span>
      )}
    </div>
  );
};

/** 3 天前, with the exact time on hover. */
export const AddedAt: FC<{ createdAt: string }> = ({ createdAt }) => {
  const time = dayjs(createdAt);
  const exact = time.format('YYYY-MM-DD HH:mm:ss');
  return (
    <time
      dateTime={time.toISOString()}
      title={exact}
      data-tooltip-id="tooltip"
      data-tooltip-content={exact}
      className="text-[13px] text-textItemBlur tabular-nums whitespace-nowrap"
    >
      {time.fromNow()}
    </time>
  );
};
