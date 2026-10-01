'use client';

import React, { FC, useCallback, useMemo, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import {
  INTERVALS,
  MonitorKind,
  MonitorPlatform,
  MonitorTarget,
  platformNames,
  platformsFor,
  useMonitorCall,
} from '@gitroom/frontend/components/monitor/monitor.hooks';

export const fieldClass = 'bg-newTableHeader rounded-[6px] px-[10px] h-[38px] text-[14px] outline-none w-full';

const INPUT: Record<MonitorKind, { label: string; placeholder: string; hint: string }> = {
  POST: {
    label: '帖子链接',
    placeholder: '粘贴帖子链接，也可以直接粘贴 App 里“复制链接”得到的整段分享文字',
    hint: '小红书请在电脑网页版打开笔记，复制地址栏完整链接（带 xsec_token）；抖音目前只能监控已连接抖音号自己的视频，别人的视频请加到“竞品”。',
  },
  ACCOUNT: {
    label: '主页链接或账号 ID',
    placeholder: '粘贴对方主页链接；只填 ID 时请先选平台',
    hint: '每次读取对方最近 10 条帖子，发了新帖会在通知里提醒你。',
  },
  KEYWORD: {
    label: '关键词',
    placeholder: '例如：露营装备、你的品牌名',
    hint: '每次读取最新的 20 条搜索结果，新内容由 AI 标记情绪，有新内容时通知你。',
  },
};

type Channel = { id: string; name: string; identifier: string; disabled?: boolean };

/** Adds a post / competitor / keyword to 监控. */
export const AddTargetModal: FC<{
  kind: MonitorKind;
  platforms: MonitorPlatform[];
  channels: Channel[];
  close: () => void;
  onAdded: (target: MonitorTarget) => void;
}> = ({ kind, platforms, channels, close, onAdded }) => {
  const t = useT();
  const toaster = useToaster();
  const call = useMonitorCall();
  const [input, setInput] = useState('');
  // the platforms that can be monitored for this kind (the others are listed as unsupported)
  const choices = useMemo(() => platformsFor(platforms, kind), [platforms, kind]);
  const [platform, setPlatform] = useState(kind === 'KEYWORD' ? choices[0]?.identifier || '' : '');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [integrationId, setIntegrationId] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState(kind === 'POST' ? 60 : 180);
  const [saving, setSaving] = useState(false);

  // readers: our usable browser channels, of the chosen platform when there is one
  const readers = useMemo(
    () =>
      channels.filter(
        (c) => !c.disabled && choices.some((p) => p.identifier === c.identifier) && (!platform || c.identifier === platform)
      ),
    [channels, choices, platform]
  );
  // POST: platforms that read a post's numbers but not its comments
  const numbersOnly = kind === 'POST' ? choices.filter((p) => !p.comments) : [];

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const target = await call('/monitoring/targets', 'POST', {
        kind,
        input: input.trim(),
        ...(platform ? { platform } : {}),
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(integrationId ? { integrationId } : {}),
        intervalMinutes,
      });
      close();
      onAdded(target);
    } catch (e) {
      toaster.show((e as Error).message, 'warning');
    } finally {
      setSaving(false);
    }
  }, [kind, input, platform, title, note, integrationId, intervalMinutes]);

  const copy = INPUT[kind];
  return (
    <form
      className="flex flex-col gap-[14px] w-full"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label className="flex flex-col gap-[6px] text-[13px]">
        <span className="text-textColor/70">{t(`monitor_input_${kind.toLowerCase()}`, copy.label)}</span>
        {kind === 'POST' ? (
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={copy.placeholder}
            className="bg-newTableHeader rounded-[6px] p-[10px] min-h-[84px] text-[14px] outline-none"
            autoFocus={true}
          />
        ) : (
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={copy.placeholder} className={fieldClass} autoFocus={true} />
        )}
        <span className="text-[12px] text-textColor/50 leading-[1.5]">{copy.hint}</span>
        <span className="text-[12px] text-textColor/50 leading-[1.5]">
          {t('monitor_supported_platforms', '支持：{{names}}', { names: platformNames(choices), interpolation: { escapeValue: false } })}
          {!!numbersOnly.length &&
            t('monitor_numbers_only', '（{{names}} 只读数据，读不到评论）', { names: platformNames(numbersOnly), interpolation: { escapeValue: false } })}
        </span>
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-[12px]">
        {kind !== 'POST' && (
          <label className="flex flex-col gap-[6px] text-[13px]">
            <span className="text-textColor/70">{t('platform', '平台')}</span>
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={fieldClass}>
              {kind === 'ACCOUNT' && <option value="">{t('monitor_platform_from_link', '从链接识别')}</option>}
              {choices.map((p) => (
                <option key={p.identifier} value={p.identifier}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === 'ACCOUNT' && (
          <label className="flex flex-col gap-[6px] text-[13px]">
            <span className="text-textColor/70">{t('monitor_account_name', '名称（可选）')}</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} className={fieldClass} placeholder={t('monitor_account_name_placeholder', '留空则用读到的昵称')} />
          </label>
        )}
        <label className="flex flex-col gap-[6px] text-[13px]">
          <span className="text-textColor/70">{t('monitor_reader', '用哪个账号读取')}</span>
          <select value={integrationId} onChange={(e) => setIntegrationId(e.target.value)} className={fieldClass}>
            <option value="">{t('monitor_reader_auto', '自动（同平台第一个可用账号）')}</option>
            {readers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-[6px] text-[13px]">
          <span className="text-textColor/70">{t('monitor_interval', '读取频率')}</span>
          <select value={intervalMinutes} onChange={(e) => setIntervalMinutes(Number(e.target.value))} className={fieldClass}>
            {INTERVALS.map((i) => (
              <option key={i.minutes} value={i.minutes}>
                {i.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-[6px] text-[13px]">
        <span className="text-textColor/70">{t('monitor_note', '备注（可选）')}</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className={fieldClass} />
      </label>

      <div className="flex justify-end gap-[8px] pt-[4px]">
        <Button type="button" secondary={true} onClick={close}>
          {t('cancel', '取消')}
        </Button>
        <Button type="submit" loading={saving} disabled={!input.trim() || (kind === 'KEYWORD' && !platform)}>
          {t('monitor_add_confirm', '开始监控')}
        </Button>
      </div>
    </form>
  );
};
