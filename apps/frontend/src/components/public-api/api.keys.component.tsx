'use client';

import React, { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import dayjs from 'dayjs';
import copy from 'copy-to-clipboard';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';

type ApiKeyRow = {
  id: string;
  note: string | null;
  prefix: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  status: 'active' | 'expired' | 'revoked';
};

const EXPIRY_OPTIONS = [
  { days: 0, label: '永久有效' },
  { days: 30, label: '30 天' },
  { days: 90, label: '90 天' },
  { days: 180, label: '180 天' },
  { days: 365, label: '1 年' },
];
const STATUS_LABELS: Record<ApiKeyRow['status'], string> = { active: '有效', expired: '已过期', revoked: '已撤销' };

const useApiKeys = () => {
  const fetch = useFetch();
  const load = useCallback(async () => (await fetch('/api-keys')).json(), []);
  return useSWR<ApiKeyRow[]>('/api-keys', load);
};

/**
 * 更多 API 密钥: named keys with a 备注 and an expiry, each revocable on its own. The key is shown
 * once when it is created; they work everywhere the original key does (public API, MCP, CLI).
 */
export const ApiKeysComponent: FC = () => {
  const fetch = useFetch();
  const toaster = useToaster();
  const { data: keys, mutate } = useApiKeys();
  const [note, setNote] = useState('');
  const [expiresInDays, setExpiresInDays] = useState(0);
  const [created, setCreated] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const create = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch('/api-keys', {
        method: 'POST',
        body: JSON.stringify({ note: note || undefined, expiresInDays }),
      });
      if (!res.ok) {
        toaster.show('创建失败，备注最多 100 个字', 'warning');
        return;
      }
      setCreated((await res.json()).key);
      setNote('');
      mutate();
    } finally {
      setSaving(false);
    }
  }, [note, expiresInDays]);

  const revoke = useCallback(async (row: ApiKeyRow) => {
    if (!(await deleteDialog(`撤销「${row.note || row.prefix}」后，用它的集成会立即失效，不能恢复。`, '撤销', '撤销密钥？', '取消'))) {
      return;
    }
    await fetch(`/api-keys/${row.id}`, { method: 'DELETE' });
    mutate();
    toaster.show('已撤销', 'success');
  }, []);

  return (
    <div className="bg-newBgColorInnerInner rounded-[12px] border border-newBorder overflow-hidden">
      <div className="bg-newBgColorInner px-[20px] py-[14px] border-b border-newBorder">
        <div className="text-[15px] font-[600]">更多 API 密钥</div>
        <div className="text-[13px] text-customColor18 mt-[2px]">
          给每个系统单独一把密钥：写上备注、设好有效期，不用了单独撤销，不影响上面的默认密钥。
        </div>
      </div>
      <div className="p-[20px] flex flex-col gap-[16px]">
        <div className="flex gap-[8px] flex-wrap items-center">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={100}
            placeholder="备注，比如：n8n 自动发帖"
            aria-label="备注"
            className="bg-newBgColorInner border border-newBorder rounded-[8px] h-[36px] px-[10px] text-[13px] w-[240px] max-w-full"
          />
          <select
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(Number(e.target.value))}
            aria-label="有效期"
            className="bg-newBgColorInner border border-newBorder rounded-[8px] h-[36px] px-[8px] text-[13px]"
          >
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.days} value={o.days}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={saving}
            onClick={create}
            className="cursor-pointer px-[16px] h-[36px] bg-[#612BD3] hover:bg-[#5520CB] disabled:opacity-50 text-white transition-colors rounded-[8px] text-[13px] font-[600]"
          >
            新建密钥
          </button>
        </div>

        {created && (
          <div className="rounded-[8px] border border-[#612BD3] p-[14px] flex flex-col gap-[8px]" role="status">
            <span className="text-[13px] font-[600]">新密钥只显示这一次，请现在复制保存</span>
            <div className="flex gap-[8px] items-center">
              <code className="flex-1 truncate text-[13px] bg-newBgColorInner rounded-[6px] px-[10px] h-[36px] leading-[36px]">{created}</code>
              <button
                type="button"
                onClick={() => {
                  copy(created);
                  toaster.show('已复制', 'success');
                }}
                className="cursor-pointer px-[16px] h-[36px] bg-btnSimple hover:bg-boxHover transition-colors rounded-[8px] text-[13px] font-[600]"
              >
                复制
              </button>
              <button type="button" onClick={() => setCreated(null)} className="px-[10px] h-[36px] text-[13px] text-customColor18 hover:text-textColor">
                我已保存
              </button>
            </div>
          </div>
        )}

        {!!keys?.length && (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] min-w-[640px]">
              <thead className="text-customColor18">
                <tr>
                  <th className="py-[8px] text-start font-normal">备注</th>
                  <th className="py-[8px] text-start font-normal">密钥</th>
                  <th className="py-[8px] text-start font-normal">创建</th>
                  <th className="py-[8px] text-start font-normal">到期</th>
                  <th className="py-[8px] text-start font-normal">最近使用</th>
                  <th className="py-[8px] text-start font-normal">状态</th>
                  <th className="py-[8px]" />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className={clsx('border-t border-newBorder', k.status !== 'active' && 'text-customColor18')}>
                    <td className="py-[8px] max-w-[200px] truncate">{k.note || '—'}</td>
                    <td className="py-[8px] font-mono">{k.prefix}…</td>
                    <td className="py-[8px] tabular-nums">{dayjs(k.createdAt).format('YYYY-MM-DD')}</td>
                    <td className="py-[8px] tabular-nums">{k.expiresAt ? dayjs(k.expiresAt).format('YYYY-MM-DD') : '永久'}</td>
                    <td className="py-[8px] tabular-nums">{k.lastUsedAt ? dayjs(k.lastUsedAt).format('MM-DD HH:mm') : '从未'}</td>
                    <td className="py-[8px]">{STATUS_LABELS[k.status]}</td>
                    <td className="py-[8px] text-end">
                      {k.status === 'active' && (
                        <button type="button" onClick={() => revoke(k)} className="text-red-400 hover:underline">
                          撤销
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
