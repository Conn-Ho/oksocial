'use client';

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { fieldClass } from '@gitroom/frontend/components/monitor/add.target.modal';
import { Segmented } from '@gitroom/frontend/components/monitor/remake.modal';
import { areaClass } from '@gitroom/frontend/components/creation/brand.form';
import {
  Brand,
  CreationPlatform,
  CreationResult,
  TEMPLATES,
  TRANSLATE_TARGETS,
  TemplateKey,
  useCreationCall,
} from '@gitroom/frontend/components/creation/creation.hooks';

const SOURCE_MAX = 6000;
const IMAGE_MAX_MB = 10;
const IMAGE_TYPES = 'image/jpeg,image/png,image/webp';
const TONES = [
  { value: 'keep', label: '保持' },
  { value: 'casual', label: '更口语' },
  { value: 'professional', label: '更专业' },
];
const LENGTHS = [
  { value: 'keep', label: '保持' },
  { value: 'shorter', label: '更短' },
  { value: 'longer', label: '更长' },
];
const SECONDS = [
  { value: '15', label: '15 秒' },
  { value: '30', label: '30 秒' },
  { value: '60', label: '60 秒' },
];
const ASPECTS = ['3:4', '1:1', '9:16', '16:9', '4:3'];
const STYLES = ['实拍质感', '简约海报', '扁平插画', '手绘水彩', '3D 渲染'];

/** What the desk was opened with (a 监控 post to remake). */
export type DeskPreset = { template?: TemplateKey; itemId?: string; targetId?: string; title?: string };

const Label: FC<{ text: string; children: React.ReactNode; hint?: string }> = ({ text, hint, children }) => (
  <label className="flex flex-col gap-[6px] text-[13px]">
    <span className="text-textColor/70">
      {text}
      {hint && <span className="text-textColor/40 ms-[6px]">{hint}</span>}
    </span>
    {children}
  </label>
);

const PlatformSelect: FC<{
  platforms: CreationPlatform[];
  value: string;
  onChange: (v: string) => void;
  anyLabel?: string;
}> = ({ platforms, value, onChange, anyLabel }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} className={fieldClass}>
    {anyLabel && <option value="">{anyLabel}</option>}
    {platforms.map((p) => (
      <option key={p.identifier} value={p.identifier}>
        {p.name}
      </option>
    ))}
  </select>
);

/** Seconds since `running` turned on, for the progress line. */
const useElapsed = (running: boolean) => {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    setSeconds(0);
    if (!running) {
      return;
    }
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return seconds;
};

/** 创作台 inputs: brand, template, the template's fields; the result goes to the parent. */
export const CreationDesk: FC<{
  brands: Brand[];
  platforms: CreationPlatform[];
  canWrite: boolean;
  preset: DeskPreset;
  onResult: (result: CreationResult) => void;
}> = ({ brands, platforms, canWrite, preset, onResult }) => {
  const t = useT();
  const toaster = useToaster();
  const call = useCreationCall();
  const defaultBrand = brands.find((b) => b.isDefault)?.id || '';
  const [brandId, setBrandId] = useState(defaultBrand);
  const [template, setTemplate] = useState<TemplateKey>(preset.template || 'adapt');
  const [busy, setBusy] = useState(false);
  const elapsed = useElapsed(busy);
  const fileInput = useRef<HTMLInputElement>(null);
  const video = platforms.find((p) => p.format === 'video')?.identifier || '';

  // one bag of fields; each template reads its own
  const [text, setText] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [instruction, setInstruction] = useState('');
  const [platform, setPlatform] = useState('');
  const [count, setCount] = useState('5');
  const [remakeFrom, setRemakeFrom] = useState<'text' | 'url' | 'monitor'>(preset.itemId || preset.targetId ? 'monitor' : 'text');
  const [url, setUrl] = useState('');
  const [tone, setTone] = useState('keep');
  const [length, setLength] = useState('keep');
  const [seconds, setSeconds] = useState('30');
  const [title, setTitle] = useState('');
  const [style, setStyle] = useState('');
  const [aspect, setAspect] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState('en');
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file]);

  useEffect(() => setBrandId((current) => current || defaultBrand), [defaultBrand]);
  useEffect(() => setChosen((current) => (current.length ? current : platforms.map((p) => p.identifier))), [platforms]);
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);
  useEffect(() => {
    if (template === 'remake' && !platform && platforms[0]) {
      setPlatform(platforms[0].identifier);
    }
    if (template === 'script' && !platform && video) {
      setPlatform(video);
    }
  }, [template, platforms]);

  const pickFile = (f: File | null) => {
    if (f && f.size > IMAGE_MAX_MB * 1024 * 1024) {
      toaster.show(t('creation_image_too_big', '图片不能超过 {{n}} MB', { n: IMAGE_MAX_MB }), 'warning');
      return;
    }
    setFile(f);
  };

  const request = (): { path: string; body: unknown } | null => {
    const brand = brandId ? { brandId } : {};
    switch (template) {
      case 'adapt':
        return { path: '/creation/adapt', body: { ...brand, text, platforms: chosen, instruction: instruction.trim() || undefined } };
      case 'titles':
        return { path: '/creation/titles', body: { ...brand, text, count: Number(count), platform: platform || undefined } };
      case 'remake':
        return {
          path: '/creation/remake',
          body: {
            ...brand,
            platform,
            tone,
            length,
            instruction: instruction.trim() || undefined,
            ...(remakeFrom === 'text' ? { text } : remakeFrom === 'url' ? { url: url.trim() } : { itemId: preset.itemId, targetId: preset.targetId }),
          },
        };
      case 'script':
        return { path: '/creation/script', body: { ...brand, brief: text, seconds: Number(seconds), platform: platform || undefined } };
      case 'cover':
        return {
          path: '/creation/cover',
          body: { ...brand, title: title.trim(), brief: text.trim() || undefined, style: style.trim() || undefined, platform: platform || undefined, aspect: aspect || undefined },
        };
      case 'translate': {
        if (!file) {
          return null;
        }
        const form = new FormData();
        form.append('file', file);
        form.append('target', target);
        return { path: '/creation/translate-image', body: form };
      }
    }
  };

  const ready =
    canWrite &&
    ((template === 'adapt' && !!text.trim() && !!chosen.length) ||
      (template === 'titles' && !!text.trim()) ||
      (template === 'remake' && !!platform && (remakeFrom === 'monitor' || (remakeFrom === 'text' ? !!text.trim() : /^https?:\/\//i.test(url.trim()) || url.includes('http')))) ||
      (template === 'script' && !!text.trim()) ||
      (template === 'cover' && (!!title.trim() || !!text.trim())) ||
      (template === 'translate' && !!file));

  const run = useCallback(async () => {
    const req = request();
    if (!req) {
      return;
    }
    setBusy(true);
    try {
      const res = await call(req.path, 'POST', req.body);
      const { generationId, ...output } = res;
      onResult({ template, generationId, input: req.body instanceof FormData ? { target, file: file?.name } : (req.body as any), output } as CreationResult);
    } catch (e) {
      toaster.show((e as Error).message, 'warning');
    } finally {
      setBusy(false);
    }
  }, [template, brandId, text, chosen, instruction, platform, count, remakeFrom, url, tone, length, seconds, title, style, aspect, file, target]);

  const current = TEMPLATES.find((x) => x.key === template)!;

  return (
    <div className="flex flex-col gap-[16px]">
      <Label text={t('creation_brand', '品牌档案')}>
        {brands.length ? (
          <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className={fieldClass}>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.isDefault ? t('creation_brand_default_suffix', '（默认）') : ''}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-[13px] text-textColor/50 leading-[1.6]">
            {t('creation_no_brand', '还没有品牌档案，AI 会按通用语气写。建一个档案后，语气、关键词和禁用词会自动生效。')}
          </span>
        )}
      </Label>

      <div role="radiogroup" aria-label={t('creation_template', '模板')} className="grid grid-cols-2 gap-[8px]">
        {TEMPLATES.map((x) => (
          <button
            key={x.key}
            type="button"
            role="radio"
            aria-checked={template === x.key}
            onClick={() => setTemplate(x.key)}
            className={clsx(
              'text-start rounded-[8px] border px-[12px] py-[10px] flex flex-col gap-[2px] transition-colors',
              template === x.key ? 'border-btnPrimary bg-newTableHeader' : 'border-newTableBorder hover:border-textColor/30'
            )}
          >
            <span className="text-[14px] font-semibold">{t(`creation_tpl_${x.key}`, x.label)}</span>
            <span className="text-[12px] text-textColor/55 leading-[1.4]">{t(`creation_tpl_${x.key}_hint`, x.hint)}</span>
          </button>
        ))}
      </div>

      {template === 'adapt' && (
        <>
          <Label text={t('creation_source_text', '原始内容')} hint={`${text.length}/${SOURCE_MAX}`}>
            <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={SOURCE_MAX} placeholder={t('creation_adapt_placeholder', '一篇文章、一段产品介绍、一条已经发过的帖子……')} className={clsx(areaClass, 'min-h-[160px]')} />
          </Label>
          <div className="flex flex-col gap-[6px] text-[13px]">
            <span className="text-textColor/70">{t('creation_platforms', '目标平台')}</span>
            <div className="flex flex-wrap gap-[6px]">
              {platforms.map((p) => {
                const on = chosen.includes(p.identifier);
                return (
                  <button
                    key={p.identifier}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setChosen((c) => (on ? c.filter((x) => x !== p.identifier) : [...c, p.identifier]))}
                    className={clsx('flex items-center gap-[6px] h-[32px] px-[10px] rounded-full border text-[13px]', on ? 'border-btnPrimary bg-newTableHeader' : 'border-newTableBorder text-textColor/60')}
                  >
                    <img src={`/icons/platforms/${p.identifier}.png`} alt="" className="w-[16px] h-[16px] rounded-full" />
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>
          <Label text={t('creation_instruction', '额外要求（可选）')}>
            <input value={instruction} onChange={(e) => setInstruction(e.target.value)} maxLength={500} placeholder={t('creation_instruction_placeholder', '例如：突出限时优惠，结尾引导评论')} className={fieldClass} />
          </Label>
        </>
      )}

      {template === 'titles' && (
        <>
          <Label text={t('creation_draft', '草稿')} hint={`${text.length}/${SOURCE_MAX}`}>
            <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={SOURCE_MAX} className={clsx(areaClass, 'min-h-[140px]')} />
          </Label>
          <div className="grid grid-cols-2 gap-[12px]">
            <Label text={t('creation_platform', '平台')}>
              <PlatformSelect platforms={platforms} value={platform} onChange={setPlatform} anyLabel={t('creation_any_platform', '不限平台')} />
            </Label>
            <Label text={t('creation_count', '标题数量')}>
              <select value={count} onChange={(e) => setCount(e.target.value)} className={fieldClass}>
                {['3', '5', '8', '10'].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Label>
          </div>
        </>
      )}

      {template === 'remake' && (
        <>
          <Segmented
            label={t('creation_remake_from', '原帖来源')}
            value={remakeFrom}
            onChange={(v) => setRemakeFrom(v as 'text' | 'url' | 'monitor')}
            options={[
              { value: 'text', label: t('creation_remake_text', '粘贴原文') },
              { value: 'url', label: t('creation_remake_url', '帖子链接') },
              ...(preset.itemId || preset.targetId ? [{ value: 'monitor', label: t('creation_remake_monitor', '监控里的帖子') }] : []),
            ]}
          />
          {remakeFrom === 'text' && (
            <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={SOURCE_MAX} placeholder={t('creation_remake_placeholder', '粘贴爆款帖子的标题和正文')} className={clsx(areaClass, 'min-h-[140px]')} />
          )}
          {remakeFrom === 'url' && (
            <>
              <input value={url} onChange={(e) => setUrl(e.target.value)} maxLength={1000} placeholder={t('creation_remake_url_placeholder', '小红书 / 抖音 / 微博 / X 的帖子链接，或整段分享文字')} className={fieldClass} />
              <span className="text-[12px] text-textColor/50">{t('creation_remake_url_hint', '链接由你在该平台已连接的账号读取，所以需要先连接一个对应平台的账号。')}</span>
            </>
          )}
          {remakeFrom === 'monitor' && (
            <p className="text-[13px] text-textColor/70">
              {t('creation_remake_monitor_item', '监控里的帖子：')}
              <span className="text-textColor">{preset.title || t('remake_untitled', '（无标题）')}</span>
            </p>
          )}
          <div className="grid grid-cols-2 gap-[12px] max-sm:grid-cols-1">
            <Label text={t('creation_remake_platform', '改写成哪个平台的帖子')}>
              <PlatformSelect platforms={platforms} value={platform} onChange={setPlatform} />
            </Label>
            <Label text={t('creation_instruction', '额外要求（可选）')}>
              <input value={instruction} onChange={(e) => setInstruction(e.target.value)} maxLength={500} placeholder={t('remake_instruction_placeholder', '例如：换成我们品牌的产品，结尾加一个提问')} className={fieldClass} />
            </Label>
          </div>
          <div className="flex flex-wrap gap-x-[20px] gap-y-[12px]">
            <Segmented label={t('remake_tone', '语气')} value={tone} onChange={setTone} options={TONES} />
            <Segmented label={t('remake_length', '篇幅')} value={length} onChange={setLength} options={LENGTHS} />
          </div>
        </>
      )}

      {template === 'script' && (
        <>
          <Label text={t('creation_script_brief', '视频要讲什么')} hint={`${text.length}/2000`}>
            <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder={t('creation_script_placeholder', '例如：新品冷萃咖啡上市，突出 0 糖、12 小时冷萃，面向上班族')} className={clsx(areaClass, 'min-h-[120px]')} />
          </Label>
          <div className="flex flex-wrap gap-[16px] items-end">
            <Segmented label={t('creation_seconds', '时长')} value={seconds} onChange={setSeconds} options={SECONDS} />
            <div className="min-w-[180px] flex-1">
              <Label text={t('creation_platform', '平台')}>
                <PlatformSelect platforms={platforms} value={platform} onChange={setPlatform} anyLabel={t('creation_any_platform', '不限平台')} />
              </Label>
            </div>
          </div>
        </>
      )}

      {template === 'cover' && (
        <>
          <Label text={t('creation_cover_title', '封面上的标题')} hint={`${title.length}/40`}>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} placeholder={t('creation_cover_title_placeholder', '例如：秋天第一杯拿铁')} className={fieldClass} />
          </Label>
          <Label text={t('creation_cover_brief', '画面描述')} hint={t('creation_optional', '可选')}>
            <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder={t('creation_cover_brief_placeholder', '例如：木桌上的一杯拿铁，窗外是落叶，暖色调')} className={clsx(areaClass, 'min-h-[88px]')} />
          </Label>
          <div className="flex flex-col gap-[6px] text-[13px]">
            <span className="text-textColor/70">{t('creation_cover_style', '风格')}</span>
            <div className="flex flex-wrap gap-[6px]">
              {STYLES.map((s) => (
                <button key={s} type="button" aria-pressed={style === s} onClick={() => setStyle(style === s ? '' : s)} className={clsx('h-[30px] px-[10px] rounded-full border text-[13px]', style === s ? 'border-btnPrimary bg-newTableHeader' : 'border-newTableBorder text-textColor/60')}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-[12px]">
            <Label text={t('creation_platform', '平台')}>
              <PlatformSelect platforms={platforms} value={platform} onChange={setPlatform} anyLabel={t('creation_any_platform', '不限平台')} />
            </Label>
            <Label text={t('creation_aspect', '比例')}>
              <select value={aspect} onChange={(e) => setAspect(e.target.value)} className={fieldClass}>
                <option value="">
                  {platform
                    ? t('creation_aspect_platform', '按平台（{{a}}）', { a: platforms.find((p) => p.identifier === platform)?.coverAspect })
                    : t('creation_aspect_default', '默认（3:4）')}
                </option>
                {ASPECTS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </Label>
          </div>
        </>
      )}

      {template === 'translate' && (
        <>
          <div className="flex items-center gap-[12px] flex-wrap">
            <input ref={fileInput} type="file" accept={IMAGE_TYPES} className="hidden" onChange={(e) => pickFile(e.target.files?.[0] || null)} />
            <Button type="button" secondary={true} onClick={() => fileInput.current?.click()}>
              {file ? t('creation_change_image', '换一张') : t('creation_pick_image', '选择图片')}
            </Button>
            <span className="text-[13px] text-textColor/60">{file ? file.name : t('creation_image_hint', 'JPG、PNG、WEBP，{{n}} MB 以内', { n: IMAGE_MAX_MB })}</span>
          </div>
          {preview && <img src={preview} alt="" className="max-h-[220px] w-fit rounded-[8px] border border-newTableBorder" />}
          <Label text={t('creation_translate_target', '翻译成')}>
            <select value={target} onChange={(e) => setTarget(e.target.value)} className={fieldClass}>
              {TRANSLATE_TARGETS.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </select>
          </Label>
        </>
      )}

      <div className="flex items-center gap-[12px] flex-wrap">
        <Button type="button" loading={busy} disabled={busy || !ready} onClick={run}>
          {t('creation_generate', '生成')}
        </Button>
        <span className="text-[13px] text-textColor/55" aria-live="polite">
          {busy
            ? current.image
              ? t('creation_running_image', '正在生成图片（{{s}} 秒），通常 10-30 秒', { s: elapsed })
              : t('creation_running', '正在生成（{{s}} 秒）', { s: elapsed })
            : !canWrite
              ? t('creation_readonly', '只读成员不能生成内容')
              : ''}
        </span>
      </div>
    </div>
  );
};
