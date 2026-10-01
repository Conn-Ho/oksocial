'use client';

import React, { FC, useCallback, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useBrowserProxies } from '@gitroom/frontend/components/settings/browser.proxies.component';

/**
 * Picks the outbound proxy for one browser channel; its browser restarts with the new egress.
 * `current` preselects the bound proxy when the caller knows it; `onSaved` follows a change.
 */
export const BrowserProxyModal: FC<{
  integrationId: string;
  current?: string | null;
  onSaved?: () => void;
}> = ({ integrationId, current, onSaved }) => {
  const fetch = useFetch();
  const modal = useModals();
  const toaster = useToaster();
  const t = useT();
  const { data } = useBrowserProxies();
  const [choice, setChoice] = useState<string>(current || '');
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    setSaving(true);
    const res = await fetch(`/browser-sessions/channels/${integrationId}/proxy`, {
      method: 'PUT',
      body: JSON.stringify({ proxyId: choice || null }),
    });
    setSaving(false);
    if (!res.ok) {
      toaster.show(t('proxy_save_failed', '设置失败，请稍后再试'), 'warning');
      return;
    }
    toaster.show(t('proxy_saved', '已切换出口，浏览器已重启'), 'success');
    onSaved?.();
    modal.closeCurrent();
  }, [choice, integrationId, onSaved]);

  return (
    <div className="flex flex-col gap-[12px] min-w-[360px]">
      <label className="flex items-center gap-[10px] cursor-pointer">
        <input type="radio" name="proxy" checked={choice === ''} onChange={() => setChoice('')} />
        <span>{t('no_proxy', '不使用代理（服务器 IP）')}</span>
      </label>
      {data?.map((p) => (
        <label key={p.id} className="flex items-center gap-[10px] cursor-pointer">
          <input type="radio" name="proxy" checked={choice === p.id} onChange={() => setChoice(p.id)} />
          <span>{p.name}</span>
          <span className="text-textColor/50 text-[12px] font-mono">{p.host}</span>
          {p.region && <span className="text-textColor/50 text-[12px]">{p.region}</span>}
        </label>
      ))}
      {!data?.length && (
        <div className="text-[13px] text-textColor/60">
          {t('no_proxies_yet', '还没有代理，先到 设置 → 出口代理 里添加。')}
        </div>
      )}
      <div>
        <Button loading={saving} onClick={save}>
          {t('save', 'Save')}
        </Button>
      </div>
    </div>
  );
};
