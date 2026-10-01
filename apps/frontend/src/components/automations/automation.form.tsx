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
  POST_ACTION_TEXT,
  SENTIMENT_TEXT,
  describeAutomation,
  parseAutomationConfig,
} from '@gitroom/helpers/automations/automation.config';
import { Automation } from '@gitroom/frontend/components/automations/automations.hooks';
import {
  MonitorPlatform,
  PlatformAction,
  platformNames,
  useMonitorPlatforms,
  useMonitorTargets,
} from '@gitroom/frontend/components/monitor/monitor.hooks';

const field = 'bg-newTableHeader rounded-[4px] h-[36px] px-[8px] text-[14px]';
const INBOX_TYPES: AutomationType[] = ['COMMENT_ASSISTANT', 'DM_ASSISTANT', 'LEAD_COLLECTOR'];
// work from 监控 targets instead of the inbox
const MONITOR_TYPES: AutomationType[] = ['POST_ACTIONS', 'PROSPECTING'];
// what the form starts from while the config is still incomplete (no monitor picked yet)
const START_CONFIG: Partial<Record<AutomationType, Record<string, any>>> = {
  POST_ACTIONS: { actions: ['like'], lookbackHours: 24, minLikes: 0, keywords: [], extraPrompt: '' },
  FOLLOW_BACK: { scan: 50, skipKeywords: [] },
  PROSPECTING: { lookbackDays: 3, keywords: [], leadPrompt: '', minScore: 70, replyWith: 'ai', templateMatch: 'ai', extraPrompt: '', saveLeads: true },
};

/** Whether automations of this type can act on a platform: 拓客 replies under comments it reads, 帖文操作 needs one of the actions. */
const canAct = (p: MonitorPlatform, type: AutomationType, actions: string[]) =>
  type === 'PROSPECTING'
    ? p.comments && p.interact.includes('replyToComment')
    : actions.some((a) => p.interact.includes(a as PlatformAction));

/** Which 监控 an automation works from: keyword + competitor monitors, or monitored posts. */
const MonitorPicker: FC<{ type: AutomationType; actions: string[]; value: string[]; onChange: (v: string[]) => void }> = ({
  type,
  actions,
  value,
  onChange,
}) => {
  const t = useT();
  const { data: keywords } = useMonitorTargets('KEYWORD');
  const { data: accounts } = useMonitorTargets('ACCOUNT');
  const { data: posts } = useMonitorTargets('POST');
  const { data: platforms } = useMonitorPlatforms();
  const choices = type === 'PROSPECTING' ? posts || [] : [...(keywords || []), ...(accounts || [])];
  const supported = (platforms || []).filter((p) => canAct(p, type, actions));
  // a monitor on a platform that cannot do it stays selectable (it is skipped with a reason), but says so
  const usable = (platform: string) => supported.some((p) => p.identifier === platform);
  return (
    <Row
      label={type === 'PROSPECTING' ? t('auto_monitor_posts', '在哪些监控帖子的评论区里找') : t('auto_monitor_sources', '对哪些监控里的新帖操作')}
      hint={`${t('auto_monitor_hint', '在「监控」里添加关键词、竞品或帖子后可选；账号要绑定出口代理。')}${
        platforms
          ? supported.length
            ? t('auto_supported_platforms', '支持的平台：{{names}}。', { names: platformNames(supported), interpolation: { escapeValue: false } })
            : t('auto_no_supported_platforms', '所选操作暂时没有平台支持。')
          : ''
      }`}
    >
      {choices.length ? (
        <div className="flex flex-wrap gap-[6px]">
          {choices.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={value.includes(m.id)}
              title={platforms && !usable(m.platform) ? t('auto_platform_unsupported', '这个平台不支持所选操作，运行时会跳过') : undefined}
              onClick={() => onChange(value.includes(m.id) ? value.filter((x) => x !== m.id) : [...value, m.id])}
              className={clsx(
                'flex items-center gap-[6px] px-[10px] h-[30px] rounded-full text-[13px] border max-w-full',
                value.includes(m.id) ? 'bg-boxFocused text-textItemFocused border-btnPrimary/40 font-[600]' : 'border-newTableBorder',
                platforms && !usable(m.platform) && 'opacity-50'
              )}
            >
              <img src={`/icons/platforms/${m.platform}.png`} alt="" className="w-[14px] h-[14px] rounded-full" />
              <span className="truncate">{m.title || m.query}</span>
            </button>
          ))}
        </div>
      ) : (
        <span className="text-[13px] text-textColor/60">{t('auto_no_monitors', '还没有可选的监控。')}</span>
      )}
    </Row>
  );
};

/** For each chosen 帖文操作 action, the platforms that can do it. */
const ActionSupport: FC<{ actions: string[] }> = ({ actions }) => {
  const t = useT();
  const { data: platforms } = useMonitorPlatforms();
  if (!platforms || !actions.length) {
    return null;
  }
  return (
    <ul className="text-[12px] text-textColor/50 leading-[1.6] -mt-[6px]">
      {actions.map((action) => (
        <li key={action}>
          {t('auto_action_support', '{{action}}：{{platforms}}', {
            action: t(`automation_action_${action}`, POST_ACTION_TEXT[action]),
            platforms:
              platformNames(platforms.filter((p) => p.interact.includes(action as PlatformAction))) ||
              t('auto_no_platform', '暂时没有平台支持'),
            interpolation: { escapeValue: false },
          })}
        </li>
      ))}
      {actions.includes('follow') && (
        <li>{t('auto_follow_needs_profile', '有的平台只能关注带主页链接的作者（比如竞品账号的帖子），关键词结果里只有昵称的作者会被跳过。')}</li>
      )}
    </ul>
  );
};

/** 回关助手 hint: the platforms that read follower lists and follow back. */
const FollowBackHint: FC = () => {
  const t = useT();
  const { data: platforms } = useMonitorPlatforms();
  const names = platformNames((platforms || []).filter((p) => p.interact.includes('followBack')));
  return <>{t('follow_back_hint', '能读粉丝列表并回关的平台：{{names}}；账号要绑定出口代理。', { names: names || '—', interpolation: { escapeValue: false } })}</>;
};

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
          value.includes(k) ? 'bg-boxFocused text-textItemFocused border-btnPrimary/40 font-[600]' : 'border-newTableBorder hover:bg-newTableHeader'
        )}
      >
        {text}
      </button>
    ))}
  </fieldset>
);

const Row: FC<{ label: string; children: React.ReactNode; hint?: React.ReactNode }> = ({ label, children, hint }) => (
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
  const [name, setName] = useState(existing?.name || t(`automation_type_${type.toLowerCase()}`, meta.label));
  const [channels, setChannels] = useState<string[]>(existing?.integrationIds || []);
  const [dailyCap, setDailyCap] = useState(existing?.dailyCap || meta.defaultCap);
  const [reviewMode, setReviewMode] = useState(existing?.reviewMode ?? type !== 'LEAD_COLLECTOR');
  const [config, setConfig] = useState<Record<string, any>>(() => {
    try {
      return parseAutomationConfig(type, existing?.config || (type === 'LEAD_COLLECTOR' ? { prompt: '对产品价格、购买方式或合作有明确兴趣的人' } : type === 'AUTO_POST' ? { topics: ['行业观察'] } : {})) as any;
    } catch {
      // incomplete (e.g. no source account yet): the 规则说明 says what is missing
      return { ...(START_CONFIG[type] || {}), ...(existing?.config || {}) };
    }
  });
  const [sample, setSample] = useState('');
  const [testOut, setTestOut] = useState('');
  const [busy, setBusy] = useState<'' | 'save' | 'test'>('');

  const set = (patch: Record<string, any>) => setConfig((c) => ({ ...c, ...patch }));
  // the shared Chinese option tables, labelled in the current language
  const labels = (prefix: string, table: Record<string, string>) =>
    Object.fromEntries(Object.entries(table).map(([k, text]) => [k, t(`${prefix}${k}`, text)]));
  const rule = useMemo(() => {
    try {
      return describeAutomation(type, config, dailyCap, reviewMode, t);
    } catch (e) {
      return t('automation_config_incomplete', '配置还不完整：{{error}}', { error: (e as Error).message, interpolation: { escapeValue: false } });
    }
  }, [type, config, dailyCap, reviewMode, t]);

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
    setTestOut(
      res.ok
        ? `${body.output}${type !== 'LEAD_COLLECTOR' || body.passes === undefined ? '' : body.passes ? t('automation_test_passes', '（会进入线索库）') : t('automation_test_below', '（分数不够，不入库）')}`
        : body?.message || t('automation_test_failed', '测试失败')
    );
  }, [type, config, sample]);

  return (
    <div className="flex flex-col gap-[14px] w-full">
      <p className="text-[13px] text-textColor/60">{t(`automation_desc_${type.toLowerCase()}`, meta.description)}</p>
      <Row label={t('name', '名称')}>
        <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className={field} />
      </Row>
      <Row label={INBOX_TYPES.includes(type) ? t('auto_watch_channels', '监控哪些账号') : MONITOR_TYPES.includes(type) ? t('auto_act_channels', '用哪些账号操作') : type === 'FOLLOW_BACK' ? t('auto_follow_back_channels', '给哪些账号回关') : type === 'REWRITE_SYNC' ? t('auto_targets', '同步到哪些账号') : t('auto_post_channels', '给哪些账号发帖')}>
        <div className="flex flex-wrap gap-[6px]">
          {channelChoices.map((i: any) => (
            <button
              key={i.id}
              type="button"
              aria-pressed={channels.includes(i.id)}
              onClick={() => setChannels((c) => (c.includes(i.id) ? c.filter((x) => x !== i.id) : [...c, i.id]))}
              className={clsx('flex items-center gap-[6px] px-[10px] h-[30px] rounded-full text-[13px] border', channels.includes(i.id) ? 'bg-boxFocused text-textItemFocused border-btnPrimary/40 font-[600]' : 'border-newTableBorder')}
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
          <Chips label={t('sentiment', '情绪')} options={labels('automation_sentiment_', SENTIMENT_TEXT)} value={config.sentiments || []} onChange={(v) => set({ sentiments: v })} />
          <Chips label={t('intent', '意向')} options={labels('automation_intent_', INTENT_TEXT)} value={config.intents || []} onChange={(v) => set({ intents: v })} />
        </>
      )}
      {MONITOR_TYPES.includes(type) && (
        <MonitorPicker type={type} actions={config.actions || []} value={config.monitorTargetIds || []} onChange={(v) => set({ monitorTargetIds: v })} />
      )}
      {type === 'POST_ACTIONS' && (
        <>
          <Chips label={t('post_actions', '操作')} options={labels('automation_action_', POST_ACTION_TEXT)} value={config.actions || []} onChange={(v) => set({ actions: v })} />
          <ActionSupport actions={config.actions || []} />
          <div className="flex flex-wrap gap-[16px]">
            <Row label={t('lookback_hours', '只看最近几小时的新帖')}>
              <input type="number" min={1} max={168} value={config.lookbackHours ?? 24} onChange={(e) => set({ lookbackHours: Number(e.target.value) })} className={clsx(field, 'w-[100px]')} />
            </Row>
            <Row label={t('min_likes', '点赞至少')}>
              <input type="number" min={0} value={config.minLikes ?? 0} onChange={(e) => set({ minLikes: Number(e.target.value) })} className={clsx(field, 'w-[100px]')} />
            </Row>
          </div>
          {(config.actions || []).includes('comment') && (
            <Row label={t('comment_prompt', '评论的额外要求（可选）')} hint={t('comment_hint', 'AI 会针对帖子内容写一句有信息量的评论，不打广告、不放链接。')}>
              <input value={config.extraPrompt || ''} maxLength={300} onChange={(e) => set({ extraPrompt: e.target.value })} className={field} placeholder={t('automation_comment_prompt_placeholder', '例如：多提问，少下结论')} />
            </Row>
          )}
        </>
      )}
      {type === 'FOLLOW_BACK' && (
        <>
          <Row label={t('follow_back_scan', '每次看最新的多少个粉丝')} hint={<FollowBackHint />}>
            <input type="number" min={10} max={200} value={config.scan ?? 50} onChange={(e) => set({ scan: Number(e.target.value) })} className={clsx(field, 'w-[100px]')} />
          </Row>
          <Row label={t('follow_back_skip', '名字或简介含这些词就不回关（逗号分隔）')}>
            <input defaultValue={(config.skipKeywords || []).join('，')} onBlur={(e) => set({ skipKeywords: words(e.target.value) })} className={field} placeholder={t('automation_skip_placeholder', '例如：空投，代写，互粉')} />
          </Row>
        </>
      )}
      {type === 'PROSPECTING' && (
        <>
          <Row label={t('lookback', '只看最近几天')}>
            <input type="number" min={1} max={30} value={config.lookbackDays ?? 3} onChange={(e) => set({ lookbackDays: Number(e.target.value) })} className={clsx(field, 'w-[100px]')} />
          </Row>
          <Row label={t('prospect_prompt', '什么样的评论者值得回复（可选：留空则回复所有符合关键词的评论）')}>
            <textarea value={config.leadPrompt || ''} maxLength={500} onChange={(e) => set({ leadPrompt: e.target.value })} className="bg-newTableHeader rounded-[4px] p-[8px] min-h-[60px] text-[14px]" placeholder={t('automation_prospect_placeholder', '例如：正在找 AI 编程工具、问价格或问怎么用的人')} />
          </Row>
          {!!config.leadPrompt && (
            <Row label={t('min_score', '回复的最低分')} hint={t('automation_score_value', '{{n}} 分', { n: config.minScore ?? 70 })}>
              <input type="range" min={0} max={100} value={config.minScore ?? 70} onChange={(e) => set({ minScore: Number(e.target.value) })} />
            </Row>
          )}
          <label className="flex items-center gap-[8px] text-[14px]">
            <input type="checkbox" checked={!!config.saveLeads} onChange={(e) => set({ saveLeads: e.target.checked })} />
            {t('save_leads', '回复过的人存入线索库')}
          </label>
        </>
      )}
      {type === 'COMMENT_ASSISTANT' && (
        <>
          <Chips label={t('kinds', '类型')} options={{ COMMENT: t('automation_kind_comment', '评论'), MENTION: t('automation_kind_mention', '@提及') }} value={config.kinds || []} onChange={(v) => set({ kinds: v })} />
          <label className="flex items-center gap-[8px] text-[14px]">
            <input type="checkbox" checked={!!config.oncePerAuthor} onChange={(e) => set({ oncePerAuthor: e.target.checked })} />
            {t('once_per_author', '同一个人在同一个帖子下只回一次')}
          </label>
        </>
      )}
      {type === 'DM_ASSISTANT' && (
        <>
          <Chips label={t('strategy', '回复策略')} options={{ once: t('automation_strategy_once', '只回第一次'), continuous: t('automation_strategy_continuous', '持续回复') }} value={[config.strategy]} onChange={(v) => set({ strategy: v[v.length - 1] || 'once' })} />
          <p className="text-[12px] text-textColor/50 -mt-[4px]">
            {t('strategy_team_override', '如果在「设置 › 同步与 AI」里选了团队的私信自动回复策略，以团队设置为准。')}
          </p>
        </>
      )}
      {(type === 'COMMENT_ASSISTANT' || type === 'DM_ASSISTANT' || MONITOR_TYPES.includes(type)) && (
        <Row label={t('keywords', '关键词（可选，逗号分隔，命中任意一个即可）')}>
          <input defaultValue={(config.keywords || []).join('，')} onBlur={(e) => set({ keywords: words(e.target.value) })} className={field} />
        </Row>
      )}
      {(type === 'COMMENT_ASSISTANT' || type === 'DM_ASSISTANT' || type === 'PROSPECTING') && (
        <>
          <Chips label={t('reply_with', '回复内容')} options={{ ai: t('automation_reply_ai', 'AI 回复'), template: t('automation_reply_template', '话术库') }} value={[config.replyWith]} onChange={(v) => set({ replyWith: v[v.length - 1] || 'ai' })} />
          {config.replyWith === 'template' && (
            <Chips label={t('template_match', '话术匹配')} options={{ ai: t('automation_match_ai', 'AI 挑最合适的'), random: t('automation_match_random', '随机') }} value={[config.templateMatch]} onChange={(v) => set({ templateMatch: v[v.length - 1] || 'ai' })} />
          )}
          <Row label={t('extra_prompt', '给 AI 的额外要求（可选）')}>
            <input value={config.extraPrompt || ''} maxLength={300} onChange={(e) => set({ extraPrompt: e.target.value })} className={field} placeholder={t('automation_extra_prompt_placeholder', '例如：遇到价格问题引导私信，不要承诺折扣')} />
          </Row>
        </>
      )}
      {type === 'LEAD_COLLECTOR' && (
        <>
          {/* no 私信: DMs are handled in okchat */}
          <Chips label={t('sources', '线索来源')} options={{ COMMENT: t('automation_kind_comment', '评论'), MENTION: t('automation_kind_mention', '@提及') }} value={(config.sources || []).filter((s: string) => s !== 'DM')} onChange={(v) => set({ sources: v })} />
          <Row label={t('lead_prompt', '什么样的人算线索（必填，500 字内）')}>
            <textarea value={config.prompt || ''} maxLength={500} onChange={(e) => set({ prompt: e.target.value })} className="bg-newTableHeader rounded-[4px] p-[8px] min-h-[70px] text-[14px]" />
          </Row>
          <Row label={t('min_score', '入库最低分')} hint={t('automation_score_value', '{{n}} 分', { n: config.minScore ?? 80 })}>
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
          <Chips label={t('tone', '语气')} options={{ keep: t('automation_option_keep', '保持'), casual: t('automation_tone_casual', '更口语'), professional: t('automation_tone_professional', '更专业') }} value={[config.tone]} onChange={(v) => set({ tone: v[v.length - 1] || 'keep' })} />
          <Chips label={t('length', '长短')} options={{ keep: t('automation_option_keep', '保持'), shorter: t('automation_length_shorter', '缩短'), longer: t('automation_length_longer', '扩写') }} value={[config.length]} onChange={(v) => set({ length: v[v.length - 1] || 'keep' })} />
          <Chips label={t('language', '语言')} options={{ keep: t('automation_option_keep', '保持'), zh: t('automation_language_zh', '中文'), en: t('automation_language_en', '英文') }} value={[config.language]} onChange={(v) => set({ language: v[v.length - 1] || 'keep' })} />
          <Chips label={t('publish', '发布方式')} options={{ draft: t('automation_publish_draft', '存草稿'), now: t('automation_publish_now', '立即发布') }} value={[config.publish]} onChange={(v) => set({ publish: v[v.length - 1] || 'draft' })} />
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
          <Chips label={t('tone', '语气')} options={{ keep: t('automation_tone_natural', '自然'), casual: t('automation_tone_casual', '更口语'), professional: t('automation_tone_professional', '更专业') }} value={[config.tone]} onChange={(v) => set({ tone: v[v.length - 1] || 'keep' })} />
          <Chips label={t('publish', '发布方式')} options={{ draft: t('automation_publish_draft', '存草稿'), schedule: t('automation_publish_schedule', '定时发布') }} value={[config.publish]} onChange={(v) => set({ publish: v[v.length - 1] || 'draft' })} />
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
          <input value={sample} onChange={(e) => setSample(e.target.value)} placeholder={type === 'AUTO_POST' ? t('automation_sample_topic', '输入一个主题试试') : type === 'REWRITE_SYNC' || type === 'POST_ACTIONS' ? t('automation_sample_post', '粘贴一段帖子正文试试') : type === 'PROSPECTING' ? t('automation_sample_comment', '粘贴一条评论试试') : type === 'FOLLOW_BACK' ? t('automation_sample_profile', '粘贴一个人的名字或简介试试') : t('automation_sample_message', '粘贴一条评论或私信试试')} className={clsx(field, 'flex-1 min-w-0')} />
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
