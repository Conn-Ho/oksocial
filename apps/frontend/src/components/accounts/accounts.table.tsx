'use client';

import React, { FC, ReactNode } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { accountStatus } from '@gitroom/helpers/utils/channel.accounts';
import { useChannelActions } from '@gitroom/frontend/components/launches/menu/use.channel.actions';
import { Account } from '@gitroom/frontend/components/accounts/accounts.hooks';
import {
  AccountIdentity,
  AccountStatusBadge,
  AccountTags,
  AddedAt,
  ExitIpCell,
  PlatformLabel,
} from '@gitroom/frontend/components/accounts/account.cells';
import { AccountActions, useAttentionAction } from '@gitroom/frontend/components/accounts/account.actions';

type Props = {
  rows: Account[];
  now: number;
  platformName: (identifier: string) => string;
  // null: the member may not manage channels and sees no actions
  actions: ReturnType<typeof useChannelActions> | null;
  onContinue: (account: Account) => void;
};

// the short columns are fixed, 账号 takes what is left
const COLUMNS = [
  { key: 'account', label: '账号', className: '' },
  { key: 'platform', label: '平台', className: 'w-[104px]' },
  { key: 'status', label: '状态', className: 'w-[144px]' },
  { key: 'exit_ip', label: '出口 IP', className: 'w-[132px]' },
  { key: 'tags', label: '标签', className: 'w-[200px]' },
  { key: 'added', label: '添加时间', className: 'w-[88px]' },
] as const;

/**
 * One row per account: a table on wide screens, cards below (a field grid from tablets up, two
 * columns of fields on phones).
 */
export const AccountsTable: FC<Props> = ({ rows, now, platformName, actions, onContinue }) => {
  const t = useT();
  const attention = useAttentionAction(actions, onContinue);
  const row = (account: Account) => {
    const status = accountStatus(account, now);
    return {
      status,
      action: attention(account, status),
      bindExitIp: actions && account.browser ? () => actions.proxy(account, account.browser?.proxy?.id) : undefined,
      editTags: actions ? () => actions.tags(account) : undefined,
      menu: actions ? <AccountActions account={account} actions={actions} /> : null,
    };
  };

  return (
    <>
      <div
        className="hidden xl:block overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-btnPrimary"
        role="region"
        aria-label={t('accounts_list', '账号列表')}
        tabIndex={0}
      >
        <table className="w-full min-w-[880px] table-fixed text-[14px]">
          <caption className="sr-only">{t('accounts_list', '账号列表')}</caption>
          <thead className="bg-newTableHeader text-[12px] text-textItemBlur">
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} scope="col" className={clsx('h-[40px] px-[12px] text-start font-normal', c.className)}>
                  {t(`accounts_col_${c.key}`, c.label)}
                </th>
              ))}
              {actions && (
                <th scope="col" className="h-[40px] w-[56px] px-[12px] font-normal">
                  <span className="sr-only">{t('accounts_col_actions', '操作')}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((account) => {
              const r = row(account);
              return (
                <tr key={account.id} className="border-t border-newBorder hover:bg-boxHover transition-colors duration-150">
                  <td className="px-[12px] py-[12px]">
                    <AccountIdentity account={account} />
                  </td>
                  <td className="px-[12px] py-[12px]">
                    <PlatformLabel identifier={account.identifier} name={platformName(account.identifier)} />
                  </td>
                  <td className="px-[12px] py-[12px]">
                    <AccountStatusBadge account={account} status={r.status} action={r.action} />
                  </td>
                  <td className="px-[12px] py-[12px]">
                    <ExitIpCell account={account} onBind={r.bindExitIp} />
                  </td>
                  <td className="px-[12px] py-[12px]">
                    <AccountTags account={account} onEdit={r.editTags} />
                  </td>
                  <td className="px-[12px] py-[12px]">
                    <AddedAt createdAt={account.createdAt} />
                  </td>
                  {r.menu && <td className="px-[12px] py-[12px] text-end">{r.menu}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="xl:hidden" aria-label={t('accounts_list', '账号列表')}>
        {rows.map((account) => {
          const r = row(account);
          return (
            <li key={account.id} className="flex flex-col gap-[12px] px-[14px] md:px-[16px] py-[14px] border-t border-newBorder first:border-t-0">
              <div className="flex items-start gap-[8px]">
                <div className="flex-1 min-w-0">
                  <AccountIdentity account={account} />
                </div>
                {r.menu}
              </div>
              <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-[12px] gap-y-[10px] text-[13px]">
                <CardField label={t('accounts_col_status', '状态')}>
                  <AccountStatusBadge account={account} status={r.status} action={r.action} />
                </CardField>
                <CardField label={t('accounts_col_platform', '平台')}>
                  <PlatformLabel identifier={account.identifier} name={platformName(account.identifier)} />
                </CardField>
                <CardField label={t('accounts_col_exit_ip', '出口 IP')}>
                  <ExitIpCell account={account} onBind={r.bindExitIp} />
                </CardField>
                <CardField label={t('accounts_col_added', '添加时间')}>
                  <AddedAt createdAt={account.createdAt} />
                </CardField>
                <CardField label={t('accounts_col_tags', '标签')} wide={true}>
                  <AccountTags account={account} onEdit={r.editTags} />
                </CardField>
              </dl>
            </li>
          );
        })}
      </ul>
    </>
  );
};

const CardField: FC<{ label: string; wide?: boolean; children: ReactNode }> = ({ label, wide, children }) => (
  <div className={clsx('flex flex-col gap-[4px] min-w-0', wide && 'col-span-2 md:col-span-4')}>
    <dt className="text-[12px] text-textItemBlur">{label}</dt>
    <dd className="min-w-0">{children}</dd>
  </div>
);
