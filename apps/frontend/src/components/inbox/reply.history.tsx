'use client';

import React, { FC, useState } from 'react';
import dayjs from 'dayjs';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useReplyHistory } from '@gitroom/frontend/components/inbox/inbox.hooks';

const SOURCE_LABEL: Record<string, string> = {
  MANUAL: '人工',
  AI: 'AI',
  TEMPLATE: '话术',
  AUTOMATION: '自动化',
};

/** Every reply sent from oksocial, newest first. */
export const ReplyHistoryModal: FC = () => {
  const t = useT();
  const [page, setPage] = useState(1);
  const { data } = useReplyHistory(page);
  return (
    <div className="flex flex-col gap-[10px] w-full">
      <div className="max-h-[60vh] overflow-auto rounded-[8px] border border-newTableBorder">
        <table className="w-full text-[13px]">
          <thead className="bg-newTableHeader sticky top-0">
            <tr>
              <th className="p-[8px] text-start">{t('time', '时间')}</th>
              <th className="p-[8px] text-start">{t('account', '账号')}</th>
              <th className="p-[8px] text-start">{t('replied_to', '回复对象')}</th>
              <th className="p-[8px] text-start">{t('reply', '回复')}</th>
              <th className="p-[8px] text-start">{t('source', '来源')}</th>
            </tr>
          </thead>
          <tbody>
            {(data || []).map((log) => (
              <tr key={log.id} className="border-t border-newTableBorder align-top">
                <td className="p-[8px] whitespace-nowrap">{dayjs(log.createdAt).format('MM-DD HH:mm')}</td>
                <td className="p-[8px]">{log.inboxItem.integration.name}</td>
                <td className="p-[8px] max-w-[220px]">
                  <div className="font-semibold">{log.inboxItem.authorName}</div>
                  <div className="text-textColor/60 line-clamp-2">{log.inboxItem.content}</div>
                </td>
                <td className="p-[8px] max-w-[260px] whitespace-pre-wrap">
                  {log.content}
                  {log.error && <div className="text-red-400 text-[12px]">{t('send_failed', '发送失败')}：{log.error}</div>}
                </td>
                <td className="p-[8px]">{SOURCE_LABEL[log.source] ?? log.source}</td>
              </tr>
            ))}
            {!data?.length && (
              <tr>
                <td colSpan={5} className="p-[24px] text-center text-textColor/60">
                  {t('history_empty', '还没有回复记录')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex justify-between text-[13px]">
        <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="disabled:opacity-40">
          {t('previous', '上一页')}
        </button>
        <button type="button" disabled={(data?.length || 0) < 30} onClick={() => setPage(page + 1)} className="disabled:opacity-40">
          {t('next', '下一页')}
        </button>
      </div>
    </div>
  );
};
