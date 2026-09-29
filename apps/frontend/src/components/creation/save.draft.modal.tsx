'use client';

import React, { FC, useCallback, useMemo, useState } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { CreationPlatform, useCreationCall } from '@gitroom/frontend/components/creation/creation.hooks';

/** One text (or thread) to save; `platform` limits the channels it can go to. */
export type DraftCandidate = { key: string; label: string; platform?: string; texts: string[] };
/** An image made on the desk during this visit (history id + its URL). */
export type SessionImage = { generationId: string; path: string };

type Channel = { id: string; name: string; identifier: string; picture?: string; disabled?: boolean; refreshNeeded?: boolean; inBetweenSteps?: boolean };

/**
 * 存为草稿: pick the channels for each text; each channel gets its own draft an hour from now,
 * with the chosen images where the platform takes images.
 */
export const SaveDraftModal: FC<{
  drafts: DraftCandidate[];
  images: SessionImage[];
  platforms: CreationPlatform[];
  close: () => void;
}> = ({ drafts, images, platforms, close }) => {
  const t = useT();
  const toaster = useToaster();
  const call = useCreationCall();
  const { data: integrations } = useIntegrationList();
  const channels: Channel[] = useMemo(
    () => (integrations || []).filter((c: Channel) => !c.disabled && !c.refreshNeeded && !c.inBetweenSteps),
    [integrations]
  );
  const channelsFor = useCallback(
    (d: DraftCandidate) => channels.filter((c) => !d.platform || c.identifier === d.platform),
    [channels]
  );
  // draft key -> chosen channel ids; every matching channel is ticked to start with
  const [picked, setPicked] = useState<Record<string, string[]> | null>(null);
  const chosen = picked ?? Object.fromEntries(drafts.map((d) => [d.key, channelsFor(d).map((c) => c.id)]));
  const [imageIds, setImageIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const toggle = (key: string, id: string) =>
    setPicked({ ...chosen, [key]: chosen[key]?.includes(id) ? chosen[key].filter((x) => x !== id) : [...(chosen[key] || []), id] });

  const posts = drafts.flatMap((d) => (chosen[d.key] || []).map((integrationId) => ({ integrationId, texts: d.texts.filter((x) => x.trim()) })));

  const save = useCallback(async () => {
    setBusy(true);
    try {
      const res = await call('/creation/drafts', 'POST', { posts, imageGenerationIds: imageIds.length ? imageIds : undefined });
      toaster.show(
        t('creation_drafts_saved', '已存为 {{n}} 条草稿（{{time}}），在日历里打开检查后再发布', {
          n: res.posts.length,
          time: dayjs(res.date).format('M月D日 HH:mm'),
        }),
        'success'
      );
      close();
    } catch (e) {
      toaster.show((e as Error).message, 'warning');
    } finally {
      setBusy(false);
    }
  }, [posts, imageIds]);

  return (
    <div className="flex flex-col gap-[16px] w-full">
      {drafts.map((d) => {
        const list = channelsFor(d);
        const name = platforms.find((p) => p.identifier === d.platform)?.name;
        return (
          <section key={d.key} className="flex flex-col gap-[8px]">
            <span className="text-[13px] text-textColor/70">
              {d.label}
              {d.texts.length > 1 && <span className="text-textColor/45 ms-[6px]">{t('creation_thread_parts', '串推 {{n}} 条', { n: d.texts.length })}</span>}
            </span>
            {list.length ? (
              <div className="flex flex-wrap gap-[6px]">
                {list.map((c) => {
                  const on = chosen[d.key]?.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(d.key, c.id)}
                      className={clsx('flex items-center gap-[6px] h-[34px] px-[10px] rounded-full border text-[13px]', on ? 'border-btnPrimary bg-newTableHeader' : 'border-newTableBorder text-textColor/60')}
                    >
                      <img src={c.picture || '/no-picture.jpg'} alt="" className="w-[18px] h-[18px] rounded-full" />
                      {c.name}
                    </button>
                  );
                })}
              </div>
            ) : (
              <span className="text-[13px] text-textColor/50">
                {t('creation_no_channel', '还没有连接可用的{{name}}账号，先到日历里添加账号。', { name: name || '' })}
              </span>
            )}
          </section>
        );
      })}

      {!!images.length && (
        <section className="flex flex-col gap-[8px]">
          <span className="text-[13px] text-textColor/70">
            {t('creation_attach_images', '附带本次生成的图片')}
            <span className="text-textColor/45 ms-[6px]">{t('creation_attach_hint', '会先存进媒体库；视频平台不附带图片')}</span>
          </span>
          <div className="flex flex-wrap gap-[8px]">
            {images.map((img) => {
              const on = imageIds.includes(img.generationId);
              return (
                <button
                  key={img.generationId}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setImageIds(on ? imageIds.filter((x) => x !== img.generationId) : [...imageIds, img.generationId])}
                  className={clsx('rounded-[8px] border-2 overflow-hidden', on ? 'border-btnPrimary' : 'border-transparent opacity-70')}
                >
                  <img src={img.path} alt="" className="h-[84px] w-auto block" />
                </button>
              );
            })}
          </div>
        </section>
      )}

      <div className="flex justify-end gap-[8px]">
        <Button type="button" secondary={true} onClick={close}>
          {t('cancel', '取消')}
        </Button>
        <Button type="button" loading={busy} disabled={busy || !posts.length} onClick={save}>
          {posts.length ? t('creation_save_n_drafts', '存为 {{n}} 条草稿', { n: posts.length }) : t('creation_pick_channels', '选择账号')}
        </Button>
      </div>
    </div>
  );
};
