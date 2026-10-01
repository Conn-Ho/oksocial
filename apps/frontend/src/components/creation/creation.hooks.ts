'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { countLength, weightedLength } from '@gitroom/helpers/utils/count.length';
import type { useT } from '@gitroom/react/translation/get.transation.service.client';

export type Brand = {
  id: string;
  name: string;
  tagline: string | null;
  products: string | null;
  audience: string | null;
  tone: string | null;
  keywords: string[];
  bannedWords: string[];
  cta: string | null;
  examples: string | null;
  source: string | null;
  isDefault: boolean;
};

export type BrandFields = Omit<Brand, 'id' | 'isDefault'>;

export type CreationPlatform = {
  identifier: string;
  name: string;
  maxLength: number;
  format: 'post' | 'thread' | 'video';
  titleMax?: number;
  imagesMax?: number;
  weighted?: boolean;
  coverAspect: string;
  region?: 'cn' | 'global';
  // an account on it can be connected (drafts can go there)
  channel?: boolean;
};

/** At most this many platforms per 跨平台适配 (the API's limit). */
export const ADAPT_MAX_PLATFORMS = 10;

export type TemplateKey = 'adapt' | 'titles' | 'remake' | 'script' | 'cover' | 'translate';

export type PlatformVersion = { platform: string; title: string; body: string; tags: string[]; script: string; parts: string[] };
export type StoredImage = { path: string; name: string; mediaId?: string };
export type ScriptShot = { visual: string; voiceover: string; caption: string; seconds: number };

/** What each template returns (plus the history id of the run). */
export type CreationOutput = {
  adapt: { versions: PlatformVersion[] };
  titles: { titles: string[]; hashtags: string[] };
  remake: { source: { title: string | null; content: string; url: string | null }; text: string; parts: string[] };
  script: { title: string; hook: string; shots: ScriptShot[]; tags: string[] };
  cover: { image: StoredImage; aspect: string };
  translate: { source: StoredImage; image: StoredImage; target: string };
};

/** A result on the desk: which template, what went in, what came out. */
export type CreationResult = {
  [K in TemplateKey]: { template: K; generationId: string; input: Record<string, any>; output: CreationOutput[K] };
}[TemplateKey];

export type Generation = {
  id: string;
  template: TemplateKey;
  brandId: string | null;
  input: Record<string, any>;
  output: any;
  error: string | null;
  createdAt: string;
  user?: { name: string | null; email: string | null } | null;
};

export const TEMPLATES: Array<{ key: TemplateKey; label: string; hint: string; image?: boolean }> = [
  { key: 'adapt', label: '跨平台适配', hint: '一段内容，改成小红书、微博、抖音、X 各自的写法' },
  { key: 'titles', label: '标题与标签', hint: '给草稿想几个不同角度的标题，配上话题' },
  { key: 'remake', label: '爆款复刻', hint: '粘贴爆款原文或链接，按你的品牌语气重写' },
  { key: 'script', label: '视频脚本', hint: '开头钩子 + 分镜表：画面、口播、字幕、时长' },
  { key: 'cover', label: '封面图', hint: '按平台比例生成封面，标题直接写在图上', image: true },
  { key: 'translate', label: '图片翻译', hint: '上传图片，换成另一种语言的文字，画面不变', image: true },
];

export const TEMPLATE_LABEL: Record<string, string> = Object.fromEntries(TEMPLATES.map((t) => [t.key, t.label]));

/** A template's name in the UI language (the desk tabs use the same creation_tpl_* keys). */
export const templateLabel = (t: ReturnType<typeof useT>, key: string) =>
  TEMPLATE_LABEL[key] ? t(`creation_tpl_${key}`, TEMPLATE_LABEL[key]) : key;

export const TRANSLATE_TARGETS = [
  { value: 'en', label: '英文' },
  { value: 'zh', label: '简体中文' },
  { value: 'zh-TW', label: '繁体中文' },
  { value: 'ja', label: '日文' },
  { value: 'ko', label: '韩文' },
  { value: 'fr', label: '法文' },
  { value: 'de', label: '德文' },
  { value: 'es', label: '西班牙文' },
];

/** A TRANSLATE_TARGETS language in the UI language; unknown values as they are. */
export const translateTargetLabel = (t: ReturnType<typeof useT>, value: string) => {
  const label = TRANSLATE_TARGETS.find((x) => x.value === value)?.label;
  return label ? t(`creation_translate_target_${value}`, label) : value;
};

/** Length as the platform counts it (X weighs CJK characters double). */
export const lengthFor = (platform: CreationPlatform | undefined, text: string) =>
  platform?.weighted ? weightedLength(text) : countLength(platform?.identifier || '', text);

export const useBrands = () => {
  const fetch = useFetch();
  const load = useCallback(async () => (await fetch('/brands')).json(), []);
  return useSWR<Brand[]>('/brands', load);
};

export const useCreationPlatforms = () => {
  const fetch = useFetch();
  const load = useCallback(async () => (await fetch('/creation/platforms')).json(), []);
  return useSWR<CreationPlatform[]>('/creation/platforms', load, { revalidateOnFocus: false });
};

export const useCreationHistory = (page: number) => {
  const fetch = useFetch();
  const key = `/creation/history?page=${page}`;
  const load = useCallback(async () => (await fetch(key)).json(), [key]);
  return useSWR<{ total: number; page: number; pages: number; items: Generation[] }>(key, load);
};

/** JSON or multipart call with the API's error message as the thrown message. */
export const useCreationCall = () => {
  const fetch = useFetch();
  return useCallback(async (path: string, method: 'POST' | 'PUT' | 'DELETE' = 'POST', body?: unknown) => {
    const res = await fetch(path, {
      method,
      body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.message || `HTTP ${res.status}`);
    }
    return data;
  }, []);
};
