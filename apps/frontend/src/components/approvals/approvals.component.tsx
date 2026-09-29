'use client';

import React, { FC, useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import dayjs from 'dayjs';
import { groupBy } from 'lodash';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Button } from '@gitroom/react/form/button';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';

type PendingPost = {
  id: string;
  group: string;
  content: string;
  publishDate: string;
  createdAt: string;
  integration: { id: string; name: string; picture?: string; providerIdentifier: string };
};

const usePendingApprovals = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/posts/approvals')).json() as Promise<PendingPost[]>;
  }, []);
  return useSWR('post-approvals', load);
};

const RejectReason: FC<{ onSubmit: (note: string) => void }> = ({ onSubmit }) => {
  const t = useT();
  const [note, setNote] = useState('');
  return (
    <div className="flex flex-col gap-[12px] min-w-[360px]">
      <textarea
        autoFocus
        value={note}
        maxLength={500}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('reject_reason_placeholder', '写给提交人的修改意见（可选）')}
        className="bg-newTableHeader rounded-[4px] p-[10px] min-h-[100px] outline-none"
      />
      <div>
        <Button onClick={() => onSubmit(note)}>{t('reject_confirm', '退回')}</Button>
      </div>
    </div>
  );
};

/** Posts from 内容运营 waiting for a 运营主管 or 管理员 before they publish. */
export const ApprovalsComponent: FC = () => {
  const fetch = useFetch();
  const t = useT();
  const toaster = useToaster();
  const modal = useModals();
  const { data, mutate, isLoading } = usePendingApprovals();
  const [busy, setBusy] = useState('');
  const groups = useMemo(() => Object.entries(groupBy(data || [], 'group')), [data]);

  const review = useCallback(
    async (group: string, decision: 'approve' | 'reject', note?: string) => {
      setBusy(group);
      const res = await fetch(`/posts/approvals/${group}`, {
        method: 'POST',
        body: JSON.stringify({ decision, note }),
      });
      setBusy('');
      if (!res.ok) {
        toaster.show(t('review_failed', '操作失败，请刷新后再试'), 'warning');
        return;
      }
      toaster.show(
        decision === 'approve'
          ? t('review_approved', '已通过，进入发布队列')
          : t('review_rejected', '已退回，提交人会收到通知'),
        'success'
      );
      mutate();
    },
    [mutate]
  );

  const reject = useCallback(
    (group: string) => () =>
      modal.openModal({
        title: t('reject_title', '退回修改'),
        withCloseButton: true,
        children: (
          <RejectReason
            onSubmit={(note) => {
              modal.closeCurrent();
              review(group, 'reject', note);
            }}
          />
        ),
      }),
    [review]
  );

  return (
    <div className="flex flex-col gap-[16px] p-[24px] flex-1">
      <div>
        <h2 className="text-[24px] font-semibold">{t('approvals', '审核')}</h2>
        <p className="text-[14px] text-textColor/60 mt-[4px]">
          {t(
            'approvals_intro',
            '内容运营提交的定时帖子在这里等待审核，通过后按原定时间发布；退回的帖子会变回草稿。'
          )}
        </p>
      </div>
      {!isLoading && !groups.length && (
        <div className="rounded-[8px] border border-newTableBorder p-[40px] text-center text-textColor/60">
          {t('approvals_empty', '没有等待审核的帖子')}
        </div>
      )}
      <div className="flex flex-col gap-[12px]">
        {groups.map(([group, posts]) => {
          const first = posts[0];
          return (
            <section
              key={group}
              className="rounded-[8px] border border-newTableBorder bg-newTableHeader/40 p-[16px] flex flex-col gap-[12px]"
            >
              <div className="flex items-center gap-[8px] flex-wrap text-[13px] text-textColor/70">
                {posts.map((p) => (
                  <span key={p.id} className="flex items-center gap-[6px] rounded-full bg-newTableHeader px-[10px] py-[4px]">
                    <img
                      src={`/icons/platforms/${p.integration.providerIdentifier}.png`}
                      alt=""
                      className="w-[16px] h-[16px] rounded-full"
                    />
                    {p.integration.name}
                  </span>
                ))}
                <span className="ms-auto">
                  {t('scheduled_for', '计划发布')} {dayjs(first.publishDate).format('YYYY-MM-DD HH:mm')}
                </span>
              </div>
              <p className="text-[14px] whitespace-pre-wrap line-clamp-6">
                {stripHtmlValidation('none', first.content)}
              </p>
              <div className="flex gap-[8px]">
                <Button loading={busy === group} onClick={() => review(group, 'approve')}>
                  {t('approve', '通过')}
                </Button>
                <Button secondary={true} disabled={busy === group} onClick={reject(group)}>
                  {t('reject', '退回')}
                </Button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};
