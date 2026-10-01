'use client';

import React, { FC, useCallback, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { fieldClass } from '@gitroom/frontend/components/monitor/add.target.modal';
import {
  AccountCandidate,
  MonitorPlatform,
  MonitorTarget,
  formatCount,
  useMonitorCall,
} from '@gitroom/frontend/components/monitor/monitor.hooks';

const Avatar: FC<{ candidate: AccountCandidate }> = ({ candidate }) =>
  candidate.avatar ? (
    <img src={candidate.avatar} alt="" className="w-[36px] h-[36px] rounded-full object-cover shrink-0" referrerPolicy="no-referrer" />
  ) : (
    <span aria-hidden={true} className="w-[36px] h-[36px] rounded-full bg-btnSimple ring-1 ring-newBorder flex items-center justify-center text-[14px] font-[600] text-textItemBlur shrink-0">
      {(candidate.name || candidate.handle).slice(0, 1).toUpperCase()}
    </span>
  );

/**
 * 竞品 › 搜索: find accounts of a platform by name through one of our channels there, and add
 * them as competitors. Platforms that cannot search send people to the paste-a-link form.
 */
export const CompetitorSearchModal: FC<{
  platforms: MonitorPlatform[];
  onAdded: (target: MonitorTarget) => void;
  onPasteLink: () => void;
}> = ({ platforms, onAdded, onPasteLink }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const call = useMonitorCall();
  const [platform, setPlatform] = useState(platforms.find((p) => p.searchAccounts)?.identifier || platforms[0]?.identifier || '');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<AccountCandidate[] | null>(null);
  const [adding, setAdding] = useState('');
  const current = platforms.find((p) => p.identifier === platform);

  const search = useCallback(async () => {
    setSearching(true);
    try {
      const res = await fetch(`/monitoring/accounts/search?${new URLSearchParams({ platform, q: query.trim() })}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.message || `HTTP ${res.status}`);
      }
      setResults(body);
    } catch (e) {
      toaster.show((e as Error).message, 'warning');
    } finally {
      setSearching(false);
    }
  }, [platform, query]);

  const add = useCallback(
    async (candidate: AccountCandidate) => {
      setAdding(candidate.handle);
      try {
        const target = await call('/monitoring/targets', 'POST', {
          kind: 'ACCOUNT',
          input: candidate.url,
          platform,
          title: candidate.name.slice(0, 60),
        });
        setResults((rows) => (rows || []).map((r) => (r.handle === candidate.handle ? { ...r, monitored: true } : r)));
        onAdded(target);
      } catch (e) {
        toaster.show((e as Error).message, 'warning');
      } finally {
        setAdding('');
      }
    },
    [platform, onAdded]
  );

  return (
    <div className="flex flex-col gap-[14px] w-full">
      <form
        className="flex flex-col sm:flex-row gap-[8px]"
        onSubmit={(e) => {
          e.preventDefault();
          if (current?.searchAccounts && query.trim()) {
            search();
          }
        }}
      >
        <select
          aria-label={t('platform', '平台')}
          value={platform}
          onChange={(e) => {
            setPlatform(e.target.value);
            setResults(null);
          }}
          className={`${fieldClass} sm:w-[160px] shrink-0`}
        >
          {platforms.map((p) => (
            <option key={p.identifier} value={p.identifier}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('competitor_search_placeholder', '输入账号名称或 ID')}
          aria-label={t('competitor_search_query', '账号名称')}
          maxLength={60}
          className={fieldClass}
          disabled={!current?.searchAccounts}
          autoFocus={true}
        />
        <Button type="submit" loading={searching} disabled={!current?.searchAccounts || !query.trim()} className="shrink-0">
          {t('search', '搜索')}
        </Button>
      </form>

      {current && !current.searchAccounts ? (
        <div className="rounded-[10px] border border-newBorder p-[14px] flex flex-col gap-[10px] items-start text-[13px] leading-[1.6]">
          <span className="text-textItemBlur">{t('competitor_search_unsupported', '这个平台暂不支持搜索，请粘贴主页链接')}</span>
          <Button secondary={true} onClick={onPasteLink}>
            {t('competitor_paste_link', '粘贴主页链接')}
          </Button>
        </div>
      ) : (
        <p className="text-[12px] text-textItemBlur leading-[1.5]">
          {t('competitor_search_hint', '用你已连接的{{name}}账号的浏览器搜索，可能需要半分钟。找不到时可以粘贴对方主页链接添加。', { name: current?.name || '' })}
        </p>
      )}

      {results && (
        <ul className="flex flex-col rounded-[10px] border border-newBorder divide-y divide-newBorder max-h-[50vh] overflow-y-auto" aria-label={t('competitor_search_results', '搜索结果')}>
          {!results.length && (
            <li className="p-[16px] text-[13px] text-textItemBlur">{t('competitor_search_empty', '没有找到相关账号，换个关键词，或粘贴主页链接添加。')}</li>
          )}
          {results.map((c) => (
            <li key={c.handle} className="flex items-center gap-[10px] p-[12px] min-w-0">
              <Avatar candidate={c} />
              <div className="flex-1 min-w-0 flex flex-col gap-[2px]">
                <span className="flex items-baseline gap-[6px] min-w-0">
                  <a href={c.url} target="_blank" rel="noreferrer" className="font-[600] text-[14px] truncate hover:underline">
                    {c.name}
                  </a>
                  {c.name !== c.handle && <span className="text-[12px] text-textItemBlur truncate">@{c.handle}</span>}
                </span>
                {c.bio && <span className="text-[12px] text-textItemBlur line-clamp-2 break-words">{c.bio}</span>}
                {c.followers !== null && c.followers !== undefined && (
                  <span className="text-[12px] text-textItemBlur tabular-nums">{t('competitor_followers', '{{n}} 粉丝', { n: formatCount(c.followers) })}</span>
                )}
              </div>
              {c.monitored ? (
                <span className="text-[12px] text-textItemBlur shrink-0">{t('competitor_already', '已在监控')}</span>
              ) : (
                <Button secondary={true} loading={adding === c.handle} disabled={!!adding} onClick={() => add(c)} className="shrink-0 !h-[32px] !px-[14px]">
                  {t('add', '添加')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
