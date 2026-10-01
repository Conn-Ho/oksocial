'use client';

import React, { FC, useCallback, useState } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Button } from '@gitroom/react/form/button';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { canManageChannels } from '@gitroom/helpers/auth/org.roles';
import { AUTOMATION_META, AUTOMATION_TYPES, AutomationType } from '@gitroom/helpers/automations/automation.config';
import {
  Automation,
  useAutomationActions,
  useAutomationStats,
  useAutomations,
} from '@gitroom/frontend/components/automations/automations.hooks';
import { AutomationForm } from '@gitroom/frontend/components/automations/automation.form';
import { AutomationStats } from '@gitroom/frontend/components/automations/automation.stats';
import { LeadsLibrary } from '@gitroom/frontend/components/automations/leads.library';

// what an action did, for actions without text (likes, follows) and the log
const KIND_TEXT: Record<string, string> = { like: '点赞', bookmark: '收藏', follow: '关注', comment: '评论', comment_reply: '评论区回复', reply: '回复', dm: '私信', post: '发帖' };
const HAS_TEXT = ['reply', 'dm', 'post', 'comment', 'comment_reply'];

const TABS = [
  { key: 'manage', label: '管理' },
  { key: 'stats', label: '统计' },
  { key: 'held', label: '待确认' },
  { key: 'log', label: '运行记录' },
  { key: 'leads', label: '线索库' },
] as const;

const STATUS_TEXT: Record<string, string> = { HELD: '待确认', DONE: '已执行', FAILED: '失败', SKIPPED: '跳过', CANCELLED: '已取消' };

const TypeShelf: FC<{ onPick: (type: AutomationType) => void }> = ({ onPick }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-[10px]">
    {AUTOMATION_TYPES.map((type) => (
      <button key={type} type="button" onClick={() => onPick(type)} className="text-start rounded-[10px] border border-newTableBorder hover:border-btnPrimary p-[14px] flex flex-col gap-[6px]">
        <span className="font-semibold">{AUTOMATION_META[type].label}</span>
        <span className="text-[13px] text-textColor/60">{AUTOMATION_META[type].description}</span>
      </button>
    ))}
  </div>
);

const Manage: FC = () => {
  const fetch = useFetch();
  const t = useT();
  const toaster = useToaster();
  const modal = useModals();
  const user = useUser();
  const canManage = canManageChannels(user?.role);
  const { data, mutate } = useAutomations();
  const { data: stats } = useAutomationStats();

  const openForm = useCallback(
    (type: AutomationType, existing?: Automation) =>
      modal.openModal({
        title: existing ? t('edit_automation', '编辑自动化') : AUTOMATION_META[type].label,
        withCloseButton: true,
        classNames: { modal: 'bg-transparent text-textColor w-[760px] max-w-[95vw]' },
        children: <AutomationForm type={type} existing={existing} onSaved={() => mutate()} />,
      }),
    [mutate]
  );

  const pickType = useCallback(
    () =>
      modal.openModal({
        title: t('new_automation', '新建自动化'),
        withCloseButton: true,
        classNames: { modal: 'bg-transparent text-textColor w-[760px] max-w-[95vw]' },
        // called with this modal's own close: closeCurrent() here would run outside the modal
        children: (close: () => void) => (
          <TypeShelf
            onPick={(type) => {
              close();
              openForm(type);
            }}
          />
        ),
      }),
    [openForm]
  );

  const patch = useCallback(async (a: Automation, body: Record<string, unknown>) => {
    await fetch(`/automations/${a.id}`, { method: 'PUT', body: JSON.stringify(body) });
    mutate();
  }, []);

  // the run happens in the background (writes are paced minutes apart); results show in 运行记录
  const runNow = useCallback(async (a: Automation) => {
    const res = await fetch(`/automations/${a.id}/run`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toaster.show(body?.message || t('run_failed', '运行失败'), 'warning');
      return;
    }
    toaster.show(
      body.running
        ? t('automation_already_running', '这个自动化正在运行，结果会出现在运行记录里')
        : t('automation_running', '已开始运行，结果会陆续出现在运行记录里'),
      'success'
    );
    setTimeout(() => mutate(), 5000);
  }, []);

  const remove = useCallback(async (a: Automation) => {
    if (await deleteDialog(t('delete_automation_confirm', '删除「{{name}}」？', { name: a.name, interpolation: { escapeValue: false } }))) {
      await fetch(`/automations/${a.id}`, { method: 'DELETE' });
      mutate();
    }
  }, []);

  return (
    <div className="flex flex-col gap-[12px]">
      {canManage && (
        <div>
          <Button onClick={pickType}>{t('new_automation', '新建自动化')}</Button>
        </div>
      )}
      {!data?.length && <p className="text-textColor/60 text-[14px] py-[20px]">{t('no_automations', '还没有自动化。建议先建一个“AI 评论助手”，开启待确认模式试运行。')}</p>}
      {(data || []).map((a) => {
        const s = stats?.[a.id] || {};
        return (
          <section key={a.id} className="rounded-[10px] border border-newTableBorder p-[16px] flex flex-col gap-[8px]">
            <div className="flex items-center gap-[10px] flex-wrap">
              <span className="font-semibold text-[16px]">{a.name}</span>
              <span className="text-[12px] rounded-full bg-newTableHeader px-[8px] py-[2px] text-textColor/70">{a.label}</span>
              {a.reviewMode && <span className="text-[12px] text-amber-400">{t('review_mode_short', '待确认模式')}</span>}
              <label className="ms-auto flex items-center gap-[6px] text-[13px] cursor-pointer">
                <input type="checkbox" disabled={!canManage} checked={a.enabled} onChange={() => patch(a, { enabled: !a.enabled })} />
                {a.enabled ? t('enabled', '已启用') : t('disabled', '已停用')}
              </label>
            </div>
            <p className="text-[13px] text-textColor/70 leading-[1.6]">{a.rule}</p>
            <div className="flex items-center gap-[14px] text-[12px] text-textColor/50 flex-wrap">
              <span>近 30 天：执行 {s.DONE || 0} · 待确认 {s.HELD || 0} · 失败 {s.FAILED || 0}</span>
              <span>{a.lastRunAt ? `上次运行 ${dayjs(a.lastRunAt).format('MM-DD HH:mm')}` : '还没运行过'}</span>
              {a.lastError && <span className="text-red-400 truncate max-w-full md:max-w-[360px]">错误：{a.lastError}</span>}
              {canManage && (
                <span className="ms-auto flex gap-[12px] text-[13px] text-textColor/80">
                  <button type="button" className="hover:underline" onClick={() => runNow(a)}>{t('run_now', '立即运行')}</button>
                  <button type="button" className="hover:underline" onClick={() => openForm(a.type, a)}>{t('edit', '编辑')}</button>
                  <button type="button" className="hover:underline text-red-400" onClick={() => remove(a)}>{t('delete', '删除')}</button>
                </span>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
};

const HeldQueue: FC = () => {
  const fetch = useFetch();
  const t = useT();
  const toaster = useToaster();
  const { data, mutate } = useAutomationActions('HELD');
  const [edits, setEdits] = useState<Record<string, string>>({});

  const review = useCallback(async (id: string, decision: 'confirm' | 'cancel') => {
    const res = await fetch(`/automations/actions/${id}/review`, { method: 'POST', body: JSON.stringify({ decision, content: edits[id] }) });
    if (!res.ok) {
      toaster.show((await res.json().catch(() => ({})))?.message || '操作失败', 'warning');
    }
    mutate();
  }, [edits]);

  if (!data?.length) {
    return <p className="text-textColor/60 text-[14px] py-[20px]">{t('no_held', '没有待确认的操作')}</p>;
  }
  return (
    <ul className="flex flex-col gap-[10px]">
      {data.map((a) => (
        <li key={a.id} className="rounded-[10px] border border-newTableBorder p-[14px] flex flex-col gap-[8px]">
          <span className="text-[12px] text-textColor/50">
            {a.automation.name} · {KIND_TEXT[a.kind] || a.kind} · {a.targetLabel} · {dayjs(a.createdAt).format('MM-DD HH:mm')}
          </span>
          {HAS_TEXT.includes(a.kind) ? (
            <textarea
              defaultValue={a.content || ''}
              onChange={(e) => setEdits((x) => ({ ...x, [a.id]: e.target.value }))}
              className="bg-newTableHeader rounded-[6px] p-[8px] min-h-[64px] text-[14px]"
              aria-label={t('action_content', '要发送的内容')}
            />
          ) : (
            <p className="text-[14px]">{`${KIND_TEXT[a.kind] || a.kind}：${a.targetLabel || ''}`}</p>
          )}
          <div className="flex gap-[8px]">
            <Button onClick={() => review(a.id, 'confirm')}>{t('confirm_send', '确认执行')}</Button>
            <Button secondary={true} onClick={() => review(a.id, 'cancel')}>{t('cancel', '取消')}</Button>
          </div>
        </li>
      ))}
    </ul>
  );
};

const RunLog: FC = () => {
  const [page, setPage] = useState(1);
  const { data } = useAutomationActions(undefined, page);
  return (
    <div className="flex flex-col gap-[8px]">
      <div className="overflow-x-auto rounded-[10px] border border-newTableBorder">
        <table className="w-full text-[13px] min-w-[640px]">
          <thead className="bg-newTableHeader text-textColor/70">
            <tr>
              <th className="p-[8px] text-start font-normal">时间</th>
              <th className="p-[8px] text-start font-normal">自动化</th>
              <th className="p-[8px] text-start font-normal">对象</th>
              <th className="p-[8px] text-start font-normal">内容</th>
              <th className="p-[8px] text-start font-normal">状态</th>
            </tr>
          </thead>
          <tbody>
            {(data || []).filter((a) => a.kind !== 'once' && a.kind !== 'thread').map((a) => (
              <tr key={a.id} className="border-t border-newTableBorder align-top">
                <td className="p-[8px] whitespace-nowrap">{dayjs(a.createdAt).format('MM-DD HH:mm')}</td>
                <td className="p-[8px]">{a.automation.name}</td>
                <td className="p-[8px]">{a.targetLabel}</td>
                <td className="p-[8px] max-w-[320px] whitespace-pre-wrap">{a.content || KIND_TEXT[a.kind]}{a.error && <div className="text-red-400">{a.error}</div>}</td>
                <td className={clsx('p-[8px]', a.status === 'FAILED' && 'text-red-400', a.status === 'DONE' && 'text-green-400')}>{STATUS_TEXT[a.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-between text-[13px]">
        <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="disabled:opacity-40">上一页</button>
        <button type="button" disabled={(data?.length || 0) < 30} onClick={() => setPage(page + 1)} className="disabled:opacity-40">下一页</button>
      </div>
    </div>
  );
};

/** 自动化: assistants and jobs as named objects, with a review queue, run log and lead library. */
export const AutomationsComponent: FC = () => {
  const t = useT();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('manage');
  return (
    <div className="flex flex-col gap-[16px] p-[16px] md:p-[24px] flex-1 min-w-0 overflow-y-auto">
      <header className="flex items-center gap-[12px] flex-wrap">
        <h2 className="sr-only">{t('automations', '自动化')}</h2>
        <nav className="flex gap-[4px] max-w-full overflow-x-auto" role="tablist">
          {TABS.map((x) => (
            <button key={x.key} type="button" role="tab" aria-selected={tab === x.key} onClick={() => setTab(x.key)} className={clsx('px-[14px] h-[34px] rounded-full text-[14px] shrink-0 whitespace-nowrap focus-visible:ring-2 focus-visible:ring-btnPrimary', tab === x.key ? 'bg-btnSimple text-textColor font-[600] ring-1 ring-newBorder' : 'text-textItemBlur hover:text-textColor hover:bg-boxHover')}>
              {t(`automations_tab_${x.key}`, x.label)}
            </button>
          ))}
        </nav>
      </header>
      {tab === 'manage' && <Manage />}
      {tab === 'stats' && <AutomationStats />}
      {tab === 'held' && <HeldQueue />}
      {tab === 'log' && <RunLog />}
      {tab === 'leads' && <LeadsLibrary />}
    </div>
  );
};
