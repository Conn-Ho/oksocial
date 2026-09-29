'use client';

import React, { FC, useCallback, useState } from 'react';
import clsx from 'clsx';
import copy from 'copy-to-clipboard';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { areaClass } from '@gitroom/frontend/components/creation/brand.form';
import {
  CreationOutput,
  CreationPlatform,
  CreationResult,
  StoredImage,
  TEMPLATE_LABEL,
  TRANSLATE_TARGETS,
  lengthFor,
  useCreationCall,
} from '@gitroom/frontend/components/creation/creation.hooks';
import { DraftCandidate, SaveDraftModal, SessionImage } from '@gitroom/frontend/components/creation/save.draft.modal';

type Shared = { platforms: CreationPlatform[]; images: SessionImage[]; canWrite: boolean };

const useActions = ({ platforms, images }: Shared) => {
  const t = useT();
  const toaster = useToaster();
  const modal = useModals();
  const copyText = useCallback((text: string) => {
    copy(text);
    toaster.show(t('creation_copied', '已复制'), 'success');
  }, []);
  const saveDrafts = useCallback(
    (drafts: DraftCandidate[]) =>
      modal.openModal({
        title: t('creation_save_drafts', '存为草稿'),
        withCloseButton: true,
        classNames: { modal: 'bg-transparent text-textColor w-[640px] max-w-[95vw]' },
        children: (close: () => void) => <SaveDraftModal drafts={drafts} images={images} platforms={platforms} close={close} />,
      }),
    [images, platforms]
  );
  return { copyText, saveDrafts };
};

/** An editable text with the platform's count. */
const PartEditor: FC<{ value: string; platform?: CreationPlatform; onChange: (v: string) => void; label?: string }> = ({ value, platform, onChange, label }) => {
  const used = lengthFor(platform, value);
  const over = !!platform && used > platform.maxLength;
  return (
    <label className="flex flex-col gap-[4px]">
      <span className="flex text-[12px] text-textColor/50">
        {label}
        {platform && <span className={clsx('ms-auto tabular-nums', over && 'text-red-400')}>{used}/{platform.maxLength}</span>}
      </span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} className={clsx(areaClass, 'min-h-[120px]')} />
    </label>
  );
};

const Actions: FC<{ children: React.ReactNode }> = ({ children }) => <div className="flex gap-[8px] flex-wrap">{children}</div>;

const AdaptView: FC<Shared & { output: CreationOutput['adapt'] }> = (props) => {
  const t = useT();
  const { copyText, saveDrafts } = useActions(props);
  const [versions, setVersions] = useState(props.output.versions);
  const setPart = (vi: number, pi: number, text: string) =>
    setVersions((vs) => vs.map((v, i) => (i === vi ? { ...v, parts: v.parts.map((p, j) => (j === pi ? text : p)) } : v)));
  const candidate = (v: (typeof versions)[number]): DraftCandidate => ({
    key: v.platform,
    label: props.platforms.find((p) => p.identifier === v.platform)?.name || v.platform,
    platform: v.platform,
    texts: v.parts,
  });
  return (
    <div className="flex flex-col gap-[14px]">
      {props.canWrite && (
        <Actions>
          <Button onClick={() => saveDrafts(versions.map(candidate))}>{t('creation_save_all', '全部存为草稿')}</Button>
        </Actions>
      )}
      {versions.map((v, vi) => {
        const platform = props.platforms.find((p) => p.identifier === v.platform);
        return (
          <section key={v.platform} className="rounded-[10px] border border-newTableBorder p-[14px] flex flex-col gap-[10px]">
            <header className="flex items-center gap-[8px]">
              <img src={`/icons/platforms/${v.platform}.png`} alt="" className="w-[20px] h-[20px] rounded-full" />
              <span className="font-semibold">{platform?.name || v.platform}</span>
              {v.parts.length > 1 && <span className="text-[12px] text-textColor/50">{t('creation_thread_parts', '串推 {{n}} 条', { n: v.parts.length })}</span>}
              <span className="ms-auto flex gap-[12px] text-[13px]">
                <button type="button" className="hover:underline" onClick={() => copyText(v.parts.join('\n\n'))}>{t('creation_copy', '复制')}</button>
                {props.canWrite && (
                  <button type="button" className="hover:underline text-btnPrimary" onClick={() => saveDrafts([candidate(v)])}>{t('creation_save_draft', '存为草稿')}</button>
                )}
              </span>
            </header>
            {v.parts.map((part, pi) => (
              <PartEditor
                key={pi}
                value={part}
                platform={platform}
                label={v.parts.length > 1 ? `${pi + 1}/${v.parts.length}` : platform?.format === 'video' ? t('creation_caption', '视频描述') : ''}
                onChange={(text) => setPart(vi, pi, text)}
              />
            ))}
            {v.script && (
              <details className="rounded-[8px] bg-newTableHeader/60 p-[10px] text-[13px]" open={true}>
                <summary className="cursor-pointer text-textColor/70 flex">
                  {t('creation_script_voiceover', '口播稿')}
                  <button type="button" className="ms-auto hover:underline" onClick={() => copyText(v.script)}>{t('creation_copy', '复制')}</button>
                </summary>
                <p className="whitespace-pre-wrap leading-[1.7] mt-[6px]">{v.script}</p>
              </details>
            )}
          </section>
        );
      })}
    </div>
  );
};

const TitlesView: FC<Shared & { output: CreationOutput['titles'] }> = (props) => {
  const t = useT();
  const { copyText } = useActions(props);
  const tags = props.output.hashtags.map((h) => `#${h}`).join(' ');
  return (
    <div className="flex flex-col gap-[14px]">
      <ol className="flex flex-col gap-[8px]">
        {props.output.titles.map((title, i) => (
          <li key={i} className="flex items-center gap-[10px] rounded-[8px] border border-newTableBorder px-[12px] py-[10px]">
            <span className="text-textColor/40 tabular-nums w-[18px]">{i + 1}</span>
            <span className="flex-1 text-[15px]">{title}</span>
            <button type="button" className="text-[13px] hover:underline" onClick={() => copyText(title)}>{t('creation_copy', '复制')}</button>
          </li>
        ))}
      </ol>
      {!!props.output.hashtags.length && (
        <div className="flex flex-col gap-[8px]">
          <span className="flex text-[13px] text-textColor/70">
            {t('creation_hashtags', '话题标签')}
            <button type="button" className="ms-auto hover:underline" onClick={() => copyText(tags)}>{t('creation_copy_all', '全部复制')}</button>
          </span>
          <div className="flex flex-wrap gap-[6px]">
            {props.output.hashtags.map((h) => (
              <span key={h} className="px-[10px] py-[3px] rounded-full bg-newTableHeader text-[13px]">#{h}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const RemakeView: FC<Shared & { output: CreationOutput['remake']; platformId: string }> = (props) => {
  const t = useT();
  const { copyText, saveDrafts } = useActions(props);
  const platform = props.platforms.find((p) => p.identifier === props.platformId);
  const [parts, setParts] = useState(props.output.parts?.length ? props.output.parts : [props.output.text]);
  return (
    <div className="flex flex-col gap-[12px]">
      <details className="rounded-[8px] bg-newTableHeader/60 p-[10px] text-[13px] max-h-[240px] overflow-y-auto">
        <summary className="cursor-pointer text-textColor/70">{t('remake_original', '原文')}</summary>
        {props.output.source.title && <p className="font-semibold my-[4px]">{props.output.source.title}</p>}
        <p className="whitespace-pre-wrap text-textColor/80 leading-[1.6]">{props.output.source.content}</p>
      </details>
      {parts.map((part, i) => (
        <PartEditor
          key={i}
          value={part}
          platform={platform}
          label={parts.length > 1 ? `${i + 1}/${parts.length}` : t('remake_result', '改写结果（可以直接改）')}
          onChange={(text) => setParts((ps) => ps.map((p, j) => (j === i ? text : p)))}
        />
      ))}
      <Actions>
        {props.canWrite && (
          <Button onClick={() => saveDrafts([{ key: 'remake', label: platform?.name || props.platformId, platform: props.platformId, texts: parts }])}>
            {t('creation_save_draft', '存为草稿')}
          </Button>
        )}
        <Button secondary={true} onClick={() => copyText(parts.join('\n\n'))}>{t('creation_copy', '复制')}</Button>
      </Actions>
    </div>
  );
};

const scriptText = (s: CreationOutput['script']) =>
  [
    s.title && `标题：${s.title}`,
    s.hook && `开头钩子：${s.hook}`,
    ...s.shots.map((shot, i) => `镜头 ${i + 1}（${shot.seconds} 秒）\n画面：${shot.visual}\n口播：${shot.voiceover}\n字幕：${shot.caption}`),
    s.tags.length && s.tags.map((x) => `#${x}`).join(' '),
  ]
    .filter(Boolean)
    .join('\n\n');

const ScriptView: FC<Shared & { output: CreationOutput['script']; platformId?: string }> = (props) => {
  const t = useT();
  const { copyText, saveDrafts } = useActions(props);
  const s = props.output;
  const total = s.shots.reduce((n, shot) => n + shot.seconds, 0);
  const caption = [s.title, s.tags.map((x) => `#${x}`).join(' ')].filter(Boolean).join('\n\n');
  const platform = props.platforms.find((p) => p.identifier === props.platformId);
  return (
    <div className="flex flex-col gap-[12px]">
      {s.title && <h3 className="text-[18px] font-semibold">{s.title}</h3>}
      {s.hook && (
        <p className="rounded-[8px] border-s-[3px] border-btnPrimary bg-newTableHeader/60 px-[12px] py-[8px] text-[14px]">
          <span className="text-textColor/50 me-[8px]">{t('creation_hook', '开头钩子')}</span>
          {s.hook}
        </p>
      )}
      <div className="overflow-x-auto rounded-[10px] border border-newTableBorder">
        <table className="w-full text-[13px] min-w-[600px]">
          <thead className="bg-newTableHeader text-textColor/70">
            <tr>
              <th className="p-[8px] text-start font-normal w-[40px]">#</th>
              <th className="p-[8px] text-start font-normal">{t('creation_shot_visual', '画面')}</th>
              <th className="p-[8px] text-start font-normal">{t('creation_shot_voiceover', '口播')}</th>
              <th className="p-[8px] text-start font-normal">{t('creation_shot_caption', '字幕')}</th>
              <th className="p-[8px] text-end font-normal w-[64px]">{t('creation_shot_seconds', '时长')}</th>
            </tr>
          </thead>
          <tbody>
            {s.shots.map((shot, i) => (
              <tr key={i} className="border-t border-newTableBorder align-top">
                <td className="p-[8px] text-textColor/40 tabular-nums">{i + 1}</td>
                <td className="p-[8px]">{shot.visual}</td>
                <td className="p-[8px]">{shot.voiceover}</td>
                <td className="p-[8px] text-textColor/80">{shot.caption}</td>
                <td className="p-[8px] text-end tabular-nums">{shot.seconds}s</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-newTableBorder text-textColor/60">
              <td className="p-[8px]" colSpan={4}>{t('creation_total', '合计')}</td>
              <td className="p-[8px] text-end tabular-nums">{total}s</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {!!s.tags.length && <p className="text-[13px] text-textColor/70">{s.tags.map((x) => `#${x}`).join(' ')}</p>}
      <Actions>
        <Button secondary={true} onClick={() => copyText(scriptText(s))}>{t('creation_copy_script', '复制脚本')}</Button>
        {props.canWrite && caption && (
          <Button onClick={() => saveDrafts([{ key: 'script', label: platform ? t('creation_caption_for', '{{name}}的视频描述', { name: platform.name }) : t('creation_caption', '视频描述'), platform: props.platformId, texts: [caption] }])}>
            {t('creation_save_caption', '标题和标签存为草稿')}
          </Button>
        )}
      </Actions>
    </div>
  );
};

const ImageActions: FC<{ generationId: string; image: StoredImage; canWrite: boolean }> = ({ generationId, image, canWrite }) => {
  const t = useT();
  const toaster = useToaster();
  const call = useCreationCall();
  const [saved, setSaved] = useState(!!image.mediaId);
  const [busy, setBusy] = useState(false);
  const save = useCallback(async () => {
    setBusy(true);
    try {
      await call(`/creation/history/${generationId}/media`);
      setSaved(true);
      toaster.show(t('creation_saved_media', '已存到媒体库，写帖子时可以直接选用'), 'success');
    } catch (e) {
      toaster.show((e as Error).message, 'warning');
    } finally {
      setBusy(false);
    }
  }, [generationId]);
  return (
    <Actions>
      {canWrite && (
        <Button loading={busy} disabled={busy || saved} onClick={save}>
          {saved ? t('creation_in_media', '已在媒体库') : t('creation_save_media', '存到媒体库')}
        </Button>
      )}
      <a href={image.path} download={image.name} target="_blank" rel="noreferrer" className="h-[40px] px-[20px] flex items-center bg-third text-[14px]">
        {t('creation_download', '下载')}
      </a>
    </Actions>
  );
};

/** The result of the last run (or a reopened one), editable where it becomes a post. */
export const CreationResults: FC<Shared & { result: CreationResult }> = ({ result, ...shared }) => {
  const t = useT();
  switch (result.template) {
    case 'adapt':
      return <AdaptView {...shared} output={result.output} />;
    case 'titles':
      return <TitlesView {...shared} output={result.output} />;
    case 'remake':
      return <RemakeView {...shared} output={result.output} platformId={result.input.platform} />;
    case 'script':
      return <ScriptView {...shared} output={result.output} platformId={result.input.platform} />;
    case 'cover':
      return (
        <div className="flex flex-col gap-[12px]">
          <img src={result.output.image.path} alt={result.input.title || ''} className="max-h-[560px] w-fit max-w-full rounded-[10px] border border-newTableBorder" />
          <span className="text-[12px] text-textColor/50">{t('creation_aspect_is', '比例 {{a}}', { a: result.output.aspect })}</span>
          <ImageActions generationId={result.generationId} image={result.output.image} canWrite={shared.canWrite} />
        </div>
      );
    case 'translate':
      return (
        <div className="flex flex-col gap-[12px]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-[12px]">
            <figure className="flex flex-col gap-[6px]">
              <img src={result.output.source.path} alt="" className="w-full rounded-[10px] border border-newTableBorder" />
              <figcaption className="text-[12px] text-textColor/50">{t('creation_original_image', '原图')}</figcaption>
            </figure>
            <figure className="flex flex-col gap-[6px]">
              <img src={result.output.image.path} alt="" className="w-full rounded-[10px] border border-newTableBorder" />
              <figcaption className="text-[12px] text-textColor/50">
                {TRANSLATE_TARGETS.find((x) => x.value === result.output.target)?.label || result.output.target}
              </figcaption>
            </figure>
          </div>
          <ImageActions generationId={result.generationId} image={result.output.image} canWrite={shared.canWrite} />
        </div>
      );
    default:
      return <p className="text-[13px] text-textColor/60">{TEMPLATE_LABEL[(result as CreationResult).template]}</p>;
  }
};
