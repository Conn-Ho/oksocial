'use client';

import React, { FC, useCallback, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Button } from '@gitroom/react/form/button';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import {
  AUTOMATION_META,
  AutomationType,
  INTENT_TEXT,
  SENTIMENT_TEXT,
  describeAutomation,
  parseAutomationConfig,
} from '@gitroom/helpers/automations/automation.config';
import { Automation } from '@gitroom/frontend/components/automations/automations.hooks';

const field = 'bg-newTableHeader rounded-[4px] h-[36px] px-[8px] text-[14px]';
const INBOX_TYPES: AutomationType[] = ['COMMENT_ASSISTANT', 'DM_ASSISTANT', 'LEAD_COLLECTOR'];

const Chips: FC<{ options: Record<string, string>; value: string[]; onChange: (v: string[]) => void; label: string }> = ({
  options,
  value,
  onChange,
  label,
}) => (
  <fieldset className="flex flex-wrap gap-[6px] items-center">
    <legend className="text-[13px] text-textColor/70 me-[6px] float-start">{label}</legend>
    {Object.entries(options).map(([k, text]) => (
      <button
        key={k}
        type="button"
        aria-pressed={value.includes(k)}
        onClick={() => onChange(value.includes(k) ? value.filter((v) => v !== k) : [...value, k])}
        className={clsx(
          'px-[10px] h-[28px] rounded-full text-[13px] border',
          value.includes(k) ? 'bg-btnPrimary text-white border-transparent' : 'border-newTableBorder hover:bg-newTableHeader'
        )}
      >
        {text}
      </button>
    ))}
  </fieldset>
);

const Row: FC<{ label: string; children: React.ReactNode; hint?: string }> = ({ label, children, hint }) => (
  <label className="flex flex-col gap-[4px]">
    <span className="text-[13px] text-textColor/70">{label}</span>
    {children}
    {hint && <span className="text-[12px] text-textColor/50">{hint}</span>}
  </label>
);

const words = (s: string) => s.split(/[,，\n]/).map((x) => x.trim()).filter(Boolean);

/** Create / edit one automation: 监控 → 触发 → 动作, with the live 规则说明 and a 测试 box. */
export const AutomationForm: FC<{ type: AutomationType; existing?: Automation; onSaved: () => void }> = ({ type, existing, onSaved }) => {
  const fetch = useFetch();
  const t = useT();
  const toaster = useToaster();
  const modal = useModals();
  const { data: integrations } = useIntegrationList();
  const meta = AUTOMATION_META[type];
  const [name, setName] = useState(existing?.name || meta.label);
  const [channels, setChannels] = useState<string[]>(existing?.integrationIds || []);
  const [dailyCap, setDailyCap] = useState(existing?.dailyCap || meta.defaultCap);
  const [reviewMode, setReviewMode] = useState(existing?.reviewMode ?? type !== 'LEAD_COLLECTOR');
  const [config, setConfig] = useState<Record<string, any>>(() => {
    try {
      return parseAutomationConfig(type, existing?.config || (type === 'LEAD_COLLECTOR' ? { prompt: '对产品价格、购买方式或合作有明确兴趣的人' } : type === 'AUTO_POST' ? { topics: ['行业观察'] } : {})) as any;
    } catch {
      // incomplete (e.g. no source account yet): the 规则说明 says what is missing
      return { ...(existing?.config || {}) };
    }
  });
  const [sample, setSample] = useState('');
  const [testOut, setTestOut] = useState('');
  const [busy, setBusy] = useState<'' | 'save' | 'test'>('');

  const set = (patch: Record<string, any>) => setConfig((c) => ({ ...c, ...patch }));
  const rule = useMemo(() => {
    try {
      return describeAutomation(type, config, dailyCap, reviewMode);
    } catch (e) {
      return `配置还不完整：${(e as Error).message}`;
    }
  }, [type, config, dailyCap, reviewMode]);

  const channelChoices = (integrations || []).filter((i: any) => !i.disabled);

  const save = useCallback(async () => {
    setBusy('save');
    const body = { name, integrationIds: channels, config, dailyCap, reviewMode };
    const res = await fetch(existing ? `/automations/${existing.id}` : '/automations', {
      method: existing ? 'PUT' : 'POST',
      body: JSON.stringify(existing ? body : { ...body, type }),
    });
    setBusy('');
    if (!res.ok) {
      toaster.show((await res.json().catch(() => ({})))?.message || t('save_failed', '保存失败'), 'warning');
      return;
    }
    toaster.show(existing ? t('saved', '已保存') : t('automation_created', '已创建（默认停用，确认无误后再启用）'), 'success');
    modal.closeCurrent();
    onSaved();
  }, [name, channels, config, dailyCap, reviewMode, existing]);

  const test = useCallback(async () => {
    setBusy('test');
    const res = await fetch('/automations/test', { method: 'POST', body: JSON.stringify({ type, config, sample }) });
    const body = await res.json().catch(() => ({}));
    setBusy('');
    setTestOut(res.ok ? `${body.output}${body.passes === undefined ? '' : body.passes ? '（会进入线索库）' : '（分数不够，不入库）'}` : body?.message || '测试失败');
  }, [type, config, sample]);

  return (
    <div className="flex flex-col gap-[14px] w-full">
      <p className="text-[13px] text-textColor/60">{meta.description}</p>
      <Row label={t('name', '名称')}>
        <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className={field} />
      </Row>
      <Row label={INBOX_TYPES.includes(type) ? t('auto_watch_channels', '监控哪些账号') : type === 'REWRITE_SYNC' ? t('auto_targets', '同步到哪些账号') : t('auto_post_channels', '给哪些账号发帖')}>
        <div className="flex flex-wrap gap-[6px]">
          {channelChoices.map((i: any) => (
            <button
              key={i.id}
              type="button"
              aria-pressed={channels.includes(i.id)}
              onClick={() => setChannels((c) => (c.includes(i.id) ? c.filter((x) => x !== i.id) : [...c, i.id]))}
              className={clsx('flex items-center gap-[6px] px-[10px] h-[30px] rounded-full text-[13px] border', channels.includes(i.id) ? 'bg-btnPrimary text-white border-transparent' : 'border-newTableBorder')}
            >
              <img src={`/icons/platforms/${i.identifier}.png`} alt="" className="w-[14px] h-[14px] rounded-full" />
              {i.name}
            </button>
          ))}
        </div>
      </Row>

      {(type === 'COMMENT_ASSISTANT' || type === 'DM_ASSISTANT' || type === 'LEAD_COLLECTOR') && (
        <>
          <Row label={t('lookback', '只看最近几天')}>
            <input type="number" min={1} max={type === 'LEAD_COLLECTOR' ? 180 : 30} value={config.lookbackDays ?? 7} onChange={(e) => set({ lookbackDays: Number(e.target.value) })} className={clsx(field, 'w-[100px]')} />
          </Row>
          <Chips label={t('sentiment', '情绪')} options={SENTIMENT_TEXT} value={config.sentiments || []} onChange={(v) => set({ sentiments: v })} />
          <Chips label={t('intent', '意向')} options={INTENT_TEXT} value={config.intents || []} onChange={(v) => set({ intents: v })} />
        </>
      )}
      {type === 'COMMENT_ASSISTANT' && (
        <>
          <Chips label={t('kinds', '类型')} options={{ COMMENT: '评论', MENTION: '@提及' }} value={config.kinds || []} onChange={(v) => set({ kinds: v })} />
          <label className="flex items-center gap-[8px] text-[14px]">
            <input type="checkbox" checked={!!config.oncePerAuthor} onChange={(e) => set({ oncePerAuthor: e.target.checked })} />
            {t('once_per_author', '同一个人在同一个帖子下只回一次')}
          </label>
        </>
      )}
      {type === 'DM_ASSISTANT' && (
        <Chips label={t('strategy', '回复策略')} options={{ once: '只回第一次', continuous: '持续回复' }} value={[config.strategy]} onChange={(v) => set({ strategy: v[v.length - 1] || 'once' })} />
      )}
      {(type === 'COMMENT_ASSISTANT' || type === 'DM_ASSISTANT') && (
        <>
          <Row label={t('keywords', '关键词（可选，逗号分隔，命中任意一个即可）')}>
            <input defaultValue={(config.keywords || []).join('，')} onBlur={(e) => set({ keywords: words(e.target.value) })} className={field} />
          </Row>
          <Chips label={t('reply_with', '回复内容')} options={{ ai: 'AI 回复', template: '话术库' }} value={[config.replyWith]} onChange={(v) => set({ replyWith: v[v.length - 1] || 'ai' })} />
          {config.replyWith === 'template' && (
            <Chips label={t('template_match', '话术匹配')} options={{ ai: 'AI 挑最合适的', random: '随机' }} value={[config.templateMatch]} onChange={(v) => set({ templateMatch: v[v.length - 1] || 'ai' })} />
          )}
          <Row label={t('extra_prompt', '给 AI 的额外要求（可选）')}>
            <input value={config.extraPrompt || ''} maxLength={300} onChange={(e) => set({ extraPrompt: e.target.value })} className={field} placeholder="例如：遇到价格问题引导私信，不要承诺折扣" />
          </Row>
        </>
      )}
      {type === 'LEAD_COLLECTOR' && (
        <>
          <Chips label={t('sources', '线索来源')} options={{ COMMENT: '评论', DM: '私信', MENTION: '@提及' }} value={config.sources || []} onChange={(v) => set({ sources: v })} />
          <Row label={t('lead_prompt', '什么样的人算线索（必填，500 字内）')}>
            <textarea value={config.prompt || ''} maxLength={500} onChange={(e) => set({ prompt: e.target.value })} className="bg-newTableHeader rounded-[4px] p-[8px] min-h-[70px] text-[14px]" />
          </Row>
          <Row label={t('min_score', '入库最低分')} hint={`${config.minScore ?? 80} 分`}>
            <input type="range" min={0} max={100} value={config.minScore ?? 80} onChange={(e) => set({ minScore: Number(e.target.value) })} />
          </Row>
        </>
      )}
      {type === 'REWRITE_SYNC' && (
        <>
          <Row label={t('sources_accounts', '来源账号')}>
            <select multiple value={config.sourceIntegrationIds || []} onChange={(e) => set({ sourceIntegrationIds: Array.from(e.target.selectedOptions).map((o) => o.value) })} className="bg-newTableHeader rounded-[4px] p-[6px] min-h-[80px] text-[14px]">
              {channelChoices.map((i: any) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </Row>
          <Chips label={t('tone', '语气')} options={{ keep: '保持', casual: '更口语', professional: '更专业' }} value={[config.tone]} onChange={(v) => set({ tone: v[v.length - 1] || 'keep' })} />
          <Chips label={t('length', '长短')} options={{ keep: '保持', shorter: '缩短', longer: '扩写' }} value={[config.length]} onChange={(v) => set({ length: v[v.length - 1] || 'keep' })} />
          <Chips label={t('language', '语言')} options={{ keep: '保持', zh: '中文', en: '英文' }} value={[config.language]} onChange={(v) => set({ language: v[v.length - 1] || 'keep' })} />
          <Chips label={t('publish', '发布方式')} options={{ draft: '存草稿', now: '立即发布' }} value={[config.publish]} onChange={(v) => set({ publish: v[v.length - 1] || 'draft' })} />
        </>
      )}
      {type === 'AUTO_POST' && (
        <>
          <Row label={t('topics', '主题（逗号分隔，每天轮换）')}>
            <input defaultValue={(config.topics || []).join('，')} onBlur={(e) => set({ topics: words(e.target.value) })} className={field} />
          </Row>
          <Row label={t('posts_per_day', '每个账号每天几条')}>
            <input type="number" min={1} max={10} value={config.postsPerDay ?? 1} onChange={(e) => set({ postsPerDay: Number(e.target.value) })} className={clsx(field, 'w-[100px]')} />
          </Row>
          <Chips label={t('tone', '语气')} options={{ keep: '自然', casual: '更口语', professional: '更专业' }} value={[config.tone]} onChange={(v) => set({ tone: v[v.length - 1] || 'keep' })} />
          <Chips label={t('publish', '发布方式')} options={{ draft: '存草稿', schedule: '定时发布' }} value={[config.publish]} onChange={(v) => set({ publish: v[v.length - 1] || 'draft' })} />
        </>
      )}

      <div className="flex flex-wrap gap-[16px] items-center">
        <Row label={t('daily_cap', '每天上限')}>
          <input type="number" min={1} max={1000} value={dailyCap} onChange={(e) => setDailyCap(Number(e.target.value))} className={clsx(field, 'w-[100px]')} />
        </Row>
        <label className="flex items-center gap-[8px] text-[14px] mt-[18px]">
          <input type="checkbox" checked={reviewMode} onChange={(e) => setReviewMode(e.target.checked)} />
          {t('review_mode', '先进入待确认，人工确认后再执行')}
        </label>
      </div>

      <div className="rounded-[8px] bg-newTableHeader p-[12px] text-[13px] leading-[1.6]">
        <b className="me-[6px]">{t('rule_explained', '规则说明')}</b>
        {rule}
      </div>

      <div className="flex flex-col gap-[6px]">
        <div className="flex gap-[8px]">
          <input value={sample} onChange={(e) => setSample(e.target.value)} placeholder={type === 'AUTO_POST' ? '输入一个主题试试' : type === 'REWRITE_SYNC' ? '粘贴一段帖子正文试试' : '粘贴一条评论或私信试试'} className={clsx(field, 'flex-1')} />
          <Button secondary={true} loading={busy === 'test'} disabled={!sample.trim() && type !== 'AUTO_POST'} onClick={test}>
            {t('test', '测试')}
          </Button>
        </div>
        {testOut && <p className="text-[13px] whitespace-pre-wrap bg-newTableHeader/60 rounded-[6px] p-[10px]">{testOut}</p>}
      </div>

      <div>
        <Button loading={busy === 'save'} disabled={!channels.length || !name.trim()} onClick={save}>
          {existing ? t('save', '保存') : t('create', '创建')}
        </Button>
      </div>
    </div>
  );
};
