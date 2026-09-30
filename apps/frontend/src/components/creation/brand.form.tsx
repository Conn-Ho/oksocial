'use client';

import React, { FC, useCallback, useRef, useState } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { Brand, BrandFields, useCreationCall } from '@gitroom/frontend/components/creation/creation.hooks';
import { fieldClass } from '@gitroom/frontend/components/monitor/add.target.modal';

export const areaClass = 'bg-newTableHeader rounded-[6px] p-[10px] text-[14px] leading-[1.6] outline-none w-full';

const SOURCES = [
  { key: 'url', label: '从网址' },
  { key: 'file', label: '上传文件' },
  { key: 'text', label: '粘贴文字' },
  { key: 'manual', label: '手动填写' },
] as const;
type SourceKey = (typeof SOURCES)[number]['key'];

const FILE_TYPES = '.pdf,.docx,.txt,.md,.markdown';
const FILE_MAX_MB = 10;

const EMPTY: BrandFields = {
  name: '',
  tagline: '',
  products: '',
  audience: '',
  tone: '',
  keywords: [],
  bannedWords: [],
  cta: '',
  examples: '',
  source: '',
};

const splitWords = (text: string) =>
  [...new Set(text.split(/[,，、;；\n]/).map((w) => w.trim()).filter(Boolean))];

const Field: FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <label className="flex flex-col gap-[6px] text-[13px]">
    <span className="text-textColor/70">
      {label}
      {hint && <span className="text-textColor/40 ms-[6px]">{hint}</span>}
    </span>
    {children}
  </label>
);

/** Word list edited as one line ("a、b、c"), shown back as chips. */
const WordsField: FC<{ label: string; hint: string; value: string[]; danger?: boolean; onChange: (v: string[]) => void }> = ({
  label,
  hint,
  value,
  danger,
  onChange,
}) => {
  const [text, setText] = useState(value.join('、'));
  return (
    <Field label={label} hint={hint}>
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(splitWords(e.target.value));
        }}
        onBlur={() => setText(splitWords(text).join('、'))}
        className={fieldClass}
      />
      {!!splitWords(text).length && (
        <span className="flex flex-wrap gap-[6px]">
          {splitWords(text).map((w) => (
            <span
              key={w}
              className={clsx(
                'px-[8px] py-[2px] rounded-full text-[12px]',
                danger ? 'bg-red-500/15 text-red-400' : 'bg-newTableHeader text-textColor/80'
              )}
            >
              {w}
            </span>
          ))}
        </span>
      )}
    </Field>
  );
};

/**
 * 品牌档案 editor. A new profile can start from a website, a document or pasted text: AI fills the
 * fields, the user checks and saves. Nothing is stored before 保存.
 */
export const BrandForm: FC<{ existing?: Brand; close: () => void; onSaved: () => void }> = ({ existing, close, onSaved }) => {
  const t = useT();
  const toaster = useToaster();
  const call = useCreationCall();
  const [source, setSource] = useState<SourceKey>(existing ? 'manual' : 'url');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fields, setFields] = useState<BrandFields>(existing ? { ...EMPTY, ...existing } : EMPTY);
  const [filled, setFilled] = useState(!!existing);
  const [busy, setBusy] = useState<'' | 'extract' | 'save'>('');
  // remounts the word inputs when AI fills them
  const [version, setVersion] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const set = useCallback(<K extends keyof BrandFields>(key: K, value: BrandFields[K]) => setFields((f) => ({ ...f, [key]: value })), []);

  const extract = useCallback(async () => {
    setBusy('extract');
    try {
      let res: { brand: BrandFields };
      if (source === 'file') {
        if (!file) {
          return;
        }
        const form = new FormData();
        form.append('file', file);
        res = await call('/brands/extract-file', 'POST', form);
      } else {
        res = await call('/brands/extract', 'POST', source === 'url' ? { url: url.trim() } : { text: text.trim() });
      }
      setFields({ ...EMPTY, ...res.brand });
      setVersion((v) => v + 1);
      setFilled(true);
      toaster.show(t('brand_extracted', 'AI 已填好，请检查后保存'), 'success');
    } catch (e) {
      toaster.show((e as Error).message, 'warning');
    } finally {
      setBusy('');
    }
  }, [source, url, text, file]);

  const save = useCallback(async () => {
    setBusy('save');
    try {
      const body = Object.fromEntries(Object.keys(EMPTY).map((key) => [key, fields[key as keyof BrandFields] ?? undefined]));
      await call(existing ? `/brands/${existing.id}` : '/brands', existing ? 'PUT' : 'POST', body);
      toaster.show(t('brand_saved', '品牌档案已保存'), 'success');
      onSaved();
      close();
    } catch (e) {
      toaster.show((e as Error).message, 'warning');
    } finally {
      setBusy('');
    }
  }, [fields, existing]);

  const pickFile = (f: File | null) => {
    if (f && f.size > FILE_MAX_MB * 1024 * 1024) {
      toaster.show(t('brand_file_too_big', '文件不能超过 {{n}} MB', { n: FILE_MAX_MB }), 'warning');
      return;
    }
    setFile(f);
  };

  const canExtract =
    (source === 'url' && /^https?:\/\/\S+\.\S+/i.test(url.trim())) ||
    (source === 'text' && text.trim().length >= 10) ||
    (source === 'file' && !!file);

  return (
    <div className="flex flex-col gap-[16px] w-full">
      {!existing && (
        <section className="flex flex-col gap-[10px] rounded-[10px] border border-newTableBorder p-[14px]">
          <div role="tablist" aria-label={t('brand_source', '从哪里建')} className="flex gap-[4px] bg-newTableHeader rounded-[8px] p-[3px] w-fit">
            {SOURCES.map((s) => (
              <button
                key={s.key}
                type="button"
                role="tab"
                aria-selected={source === s.key}
                onClick={() => {
                  setSource(s.key);
                  if (s.key === 'manual') {
                    setFilled(true);
                  }
                }}
                className={clsx('px-[12px] h-[30px] rounded-full text-[13px]', source === s.key ? 'bg-btnSimple text-textColor font-[600] ring-1 ring-newBorder' : 'text-textItemBlur hover:text-textColor hover:bg-boxHover')}
              >
                {t(`brand_source_${s.key}`, s.label)}
              </button>
            ))}
          </div>
          {source === 'url' && (
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('brand_url_placeholder', '品牌官网或产品页，例如 https://www.example.com')}
              className={fieldClass}
              autoFocus={true}
            />
          )}
          {source === 'text' && (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={20000}
              placeholder={t('brand_text_placeholder', '粘贴品牌介绍、产品说明、以往的文案……')}
              className={clsx(areaClass, 'min-h-[140px]')}
            />
          )}
          {source === 'file' && (
            <div className="flex items-center gap-[10px] flex-wrap">
              <input ref={fileInput} type="file" accept={FILE_TYPES} className="hidden" onChange={(e) => pickFile(e.target.files?.[0] || null)} />
              <Button type="button" secondary={true} onClick={() => fileInput.current?.click()}>
                {t('brand_pick_file', '选择文件')}
              </Button>
              <span className="text-[13px] text-textColor/60">
                {file ? file.name : t('brand_file_hint', 'PDF、Word（.docx）、TXT 或 Markdown，{{n}} MB 以内；只用来提取，不会保存', { n: FILE_MAX_MB })}
              </span>
            </div>
          )}
          {source !== 'manual' && (
            <div className="flex items-center gap-[10px]">
              <Button type="button" loading={busy === 'extract'} disabled={!!busy || !canExtract} onClick={extract}>
                {filled ? t('brand_extract_again', '重新提取') : t('brand_extract', 'AI 提取')}
              </Button>
              {busy === 'extract' && <span className="text-[13px] text-textColor/60">{t('brand_extracting', '正在读取并整理，约 10-30 秒')}</span>}
            </div>
          )}
        </section>
      )}

      {filled && (
        <div key={version} className="grid grid-cols-1 md:grid-cols-2 gap-[12px]">
          <Field label={t('brand_name', '品牌名')}>
            <input value={fields.name} onChange={(e) => set('name', e.target.value)} maxLength={60} className={fieldClass} />
          </Field>
          <Field label={t('brand_tagline', '一句话介绍')}>
            <input value={fields.tagline || ''} onChange={(e) => set('tagline', e.target.value)} maxLength={200} className={fieldClass} />
          </Field>
          <Field label={t('brand_products', '产品/服务')}>
            <textarea value={fields.products || ''} onChange={(e) => set('products', e.target.value)} maxLength={2000} className={clsx(areaClass, 'min-h-[88px]')} />
          </Field>
          <Field label={t('brand_audience', '目标人群')}>
            <textarea value={fields.audience || ''} onChange={(e) => set('audience', e.target.value)} maxLength={1000} className={clsx(areaClass, 'min-h-[88px]')} />
          </Field>
          <Field label={t('brand_tone', '语气风格')} hint={t('brand_tone_hint', '例如：专业克制、活泼口语')}>
            <input value={fields.tone || ''} onChange={(e) => set('tone', e.target.value)} maxLength={500} className={fieldClass} />
          </Field>
          <Field label={t('brand_cta', '行动引导（CTA）')} hint={t('brand_cta_hint', '结尾号召用语')}>
            <input value={fields.cta || ''} onChange={(e) => set('cta', e.target.value)} maxLength={300} className={fieldClass} />
          </Field>
          <WordsField
            label={t('brand_keywords', '常用关键词')}
            hint={t('brand_words_hint', '用顿号或逗号分隔')}
            value={fields.keywords}
            onChange={(v) => set('keywords', v)}
          />
          <WordsField
            label={t('brand_banned', '禁用词')}
            hint={t('brand_banned_hint', 'AI 生成的内容里一定不会出现')}
            value={fields.bannedWords}
            danger={true}
            onChange={(v) => set('bannedWords', v)}
          />
          <div className="md:col-span-2">
            <Field label={t('brand_examples', '示例文案')} hint={t('brand_examples_hint', 'AI 学它的语气和用词，不会照抄')}>
              <textarea value={fields.examples || ''} onChange={(e) => set('examples', e.target.value)} maxLength={3000} className={clsx(areaClass, 'min-h-[110px]')} />
            </Field>
          </div>
        </div>
      )}

      {filled && (
        <div className="flex justify-end gap-[8px]">
          <Button type="button" secondary={true} onClick={close}>
            {t('cancel', '取消')}
          </Button>
          <Button type="button" loading={busy === 'save'} disabled={!!busy || !fields.name.trim()} onClick={save}>
            {t('save', '保存')}
          </Button>
        </div>
      )}
    </div>
  );
};
