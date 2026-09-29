'use client';

import React, { FC, Fragment, useCallback } from 'react';
import useSWR from 'swr';
import { object, string } from 'yup';
import { FormProvider, useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';

export type BrowserProxy = {
  id: string;
  name: string;
  host: string;
  region?: string | null;
  slots: number;
};

export const useBrowserProxies = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/browser-sessions/proxies')).json() as Promise<BrowserProxy[]>;
  }, []);
  return useSWR('browser-proxies', load);
};

/** Settings tab: the outbound proxies (static residential/ISP IPs) browser channels can use. */
export const BrowserProxiesComponent: FC = () => {
  const fetch = useFetch();
  const modal = useModals();
  const toaster = useToaster();
  const t = useT();
  const { data, mutate } = useBrowserProxies();

  const add = useCallback(() => {
    modal.openModal({
      title: t('add_proxy', '添加代理'),
      withCloseButton: true,
      children: <AddBrowserProxy reload={mutate} />,
    });
  }, [mutate]);

  const remove = useCallback(
    (proxy: BrowserProxy) => async () => {
      if (
        await deleteDialog(
          t('delete_proxy_confirm', '删除代理 {{name}}？已绑定的账号会改为直连。', {
            name: proxy.name,
          })
        )
      ) {
        await fetch(`/browser-sessions/proxies/${proxy.id}`, { method: 'DELETE' });
        mutate();
        toaster.show(t('proxy_deleted', '代理已删除'), 'success');
      }
    },
    [mutate]
  );

  return (
    <div className="flex flex-col">
      <h3 className="text-[20px]">{t('browser_proxies', '出口代理')}</h3>
      <div className="text-customColor18 mt-[4px]">
        {t(
          'browser_proxies_intro',
          '浏览器通道的账号默认从服务器机房 IP 访问平台。要发帖、评论的账号，建议每个号绑定一个独立的静态住宅 IP，降低被判定为自动化的风险。'
        )}
      </div>
      <div className="my-[16px] bg-sixth border-fifth border rounded-[4px] p-[24px] flex flex-col gap-[16px]">
        {!!data?.length && (
          <div className="grid grid-cols-[1.2fr,1.6fr,0.8fr,0.6fr,auto] gap-y-[10px] gap-x-[16px] items-center">
            <div className="text-textColor/60">{t('name', 'Name')}</div>
            <div className="text-textColor/60">{t('proxy_address', '地址')}</div>
            <div className="text-textColor/60">{t('region', '地区')}</div>
            <div className="text-textColor/60">{t('bound_channels', '绑定账号')}</div>
            <div />
            {data.map((p) => (
              <Fragment key={p.id}>
                <div className="truncate">{p.name}</div>
                <div className="truncate font-mono text-[13px]">{p.host}</div>
                <div>{p.region || '—'}</div>
                <div>{p.slots}</div>
                <Button secondary={true} onClick={remove(p)}>
                  {t('delete', 'Delete')}
                </Button>
              </Fragment>
            ))}
          </div>
        )}
        <div>
          <Button onClick={add}>{t('add_proxy', '添加代理')}</Button>
        </div>
      </div>
    </div>
  );
};

const proxySchema = object().shape({
  name: string().required().max(60),
  url: string()
    .required()
    .matches(
      /^(https?|socks5h?):\/\/([^\s:@/]+(:[^\s@/]*)?@)?[^\s:@/]+:\d{2,5}\/?$/,
      'http://user:pass@host:port 或 socks5://host:port'
    ),
  region: string().max(40),
});

const AddBrowserProxy: FC<{ reload: () => void }> = ({ reload }) => {
  const fetch = useFetch();
  const modal = useModals();
  const toaster = useToaster();
  const t = useT();
  const form = useForm({
    resolver: yupResolver(proxySchema),
    values: { name: '', url: '', region: '' },
  });

  const submit = useCallback(async (values: any) => {
    const res = await fetch('/browser-sessions/proxies', {
      method: 'POST',
      body: JSON.stringify({ ...values, region: values.region || undefined }),
    });
    if (!res.ok) {
      toaster.show(t('proxy_invalid', '代理地址格式不对'), 'warning');
      return;
    }
    toaster.show(t('proxy_added', '代理已添加'), 'success');
    modal.closeCurrent();
    reload();
  }, []);

  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-[12px]">
        <Input label={t('name', 'Name')} name="name" placeholder="台湾住宅 IP 1" />
        <Input
          label={t('proxy_address', '地址')}
          name="url"
          placeholder="http://user:pass@1.2.3.4:8000"
          autoComplete="off"
        />
        <Input label={t('region', '地区')} name="region" placeholder="TW" />
        <div>
          <Button type="submit">{t('save', 'Save')}</Button>
        </div>
      </form>
    </FormProvider>
  );
};
