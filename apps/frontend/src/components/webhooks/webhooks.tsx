'use client';

import React, { FC, Fragment, useCallback, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/react/form/button';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Input } from '@gitroom/react/form/input';
import { FormProvider, useForm } from 'react-hook-form';
import { array, boolean, object, string } from 'yup';
import { yupResolver } from '@hookform/resolvers/yup';
import { Select } from '@gitroom/react/form/select';
import { PickPlatforms } from '@gitroom/frontend/components/launches/helpers/pick.platform.component';
import { useToaster } from '@gitroom/react/toaster/toaster';
import clsx from 'clsx';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  WEBHOOK_FORMATS,
  WEBHOOK_FORMAT_META,
  WebhookFormat,
} from '@gitroom/helpers/utils/webhook.formats';

// The URL of a bot carries its token; the list shows only the host.
const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

export const Webhooks: FC = () => {
  const fetch = useFetch();
  const user = useUser();
  const modal = useModals();
  const toaster = useToaster();
  const t = useT();
  const list = useCallback(async () => {
    return (await fetch('/webhooks')).json();
  }, []);
  const { data, mutate } = useSWR('webhooks', list);
  const addWebhook = useCallback(
    (data?: any) => () => {
      modal.openModal({
        title: data ? t('update_webhook', 'Update webhook') : t('add_webhook', 'Add webhook'),
        withCloseButton: true,
        children: <AddOrEditWebhook data={data} reload={mutate} />,
      });
    },
    [t]
  );
  const deleteHook = useCallback(
    (data: any) => async () => {
      if (
        await deleteDialog(
          t(
            'are_you_sure_you_want_to_delete',
            `Are you sure you want to delete ${data.name}?`,
            { name: data.name }
          )
        )
      ) {
        await fetch(`/webhooks/${data.id}`, {
          method: 'DELETE',
        });
        mutate();
        toaster.show(t('webhook_deleted_successfully', 'Webhook deleted successfully'), 'success');
      }
    },
    []
  );

  return (
    <div className="flex flex-col">
      <h3 className="text-[20px]">
        {t('webhooks', 'Webhooks')} ({data?.length || 0}/{user?.tier?.webhooks})
      </h3>
      <div className="text-customColor18 mt-[4px]">
        {t(
          'webhooks_are_a_way_to_get_notified_when_something_happens_in_postiz_via_an_http_request',
          'Webhooks are a way to get notified when something happens in oksocial via\n        an HTTP request.'
        )}
      </div>
      <div className="my-[16px] mt-[16px] bg-sixth border-fifth items-center border rounded-[4px] p-[12px] md:p-[24px] flex gap-[24px]">
        <div className="flex flex-col w-full">
          {!!data?.length && (
            <div className="grid grid-cols-[1fr,1fr,auto,auto] md:grid-cols-[1fr,1fr,1fr,1fr] w-full gap-y-[10px] gap-x-[8px] md:gap-x-0">
              <div>{t('name', 'Name')}</div>
              <div>{t('webhook_target', '类型 / 地址')}</div>
              <div>{t('edit', 'Edit')}</div>
              <div>{t('delete', 'Delete')}</div>
              {data?.map((p: any) => (
                <Fragment key={p.id}>
                  <div className="flex flex-col justify-center">{p.name}</div>
                  <div className="flex flex-col justify-center min-w-0">
                    <span>
                      {t(
                        `webhook_format_${(p.format || 'GENERIC').toLowerCase()}`,
                        WEBHOOK_FORMAT_META[(p.format || 'GENERIC') as WebhookFormat].label
                      )}
                      {p.notifications ? ` · ${t('webhook_with_notifications', '含站内通知')}` : ''}
                    </span>
                    <span className="text-textItemBlur text-[12px] truncate">{hostOf(p.url)}</span>
                  </div>
                  <div className="flex flex-col justify-center">
                    <div>
                      <Button onClick={addWebhook(p)}>
                        {t('edit', 'Edit')}
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col justify-center">
                    <div>
                      <Button onClick={deleteHook(p)}>
                        {t('delete', 'Delete')}
                      </Button>
                    </div>
                  </div>
                </Fragment>
              ))}
            </div>
          )}
          <div>
            <Button
              onClick={addWebhook()}
              className={clsx((data?.length || 0) > 0 && 'my-[16px]')}
            >
              {t('add_a_webhook', 'Add a webhook')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
const details = object().shape({
  name: string().required(),
  url: string().url().required(),
  format: string().oneOf([...WEBHOOK_FORMATS]).required(),
  secret: string(),
  notifications: boolean(),
  integrations: array(),
});
const getWebhookOptions = (t: (key: string, fallback: string) => string) => [
  {
    label: t('all_integrations', 'All integrations'),
    value: 'all',
  },
  {
    label: t('specific_integrations', 'Specific integrations'),
    value: 'specific',
  },
];
export const AddOrEditWebhook: FC<{
  data?: any;
  reload: () => void;
}> = (props) => {
  const { data, reload } = props;
  const fetch = useFetch();
  const t = useT();
  const options = getWebhookOptions(t);
  const [allIntegrations, setAllIntegrations] = useState(
    (data?.integrations?.length || 0) > 0 ? options[1] : options[0]
  );
  const modal = useModals();
  const toast = useToaster();
  const form = useForm({
    resolver: yupResolver(details),
    values: {
      name: data?.name || '',
      url: data?.url || '',
      format: (data?.format || 'GENERIC') as WebhookFormat,
      secret: '',
      notifications: !!data?.notifications,
      integrations: data?.integrations?.map((p: any) => p.integration) || [],
    },
  });
  const integrations = form.watch('integrations');
  const format = form.watch('format') as WebhookFormat;
  const metaFormat: WebhookFormat = WEBHOOK_FORMAT_META[format] ? format : 'GENERIC';
  const meta = WEBHOOK_FORMAT_META[metaFormat];
  const integration = useCallback(async () => {
    return (await fetch('/integrations/list')).json();
  }, []);
  const changeIntegration = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const findValue = options.find(
        (option) => option.value === e.target.value
      )!;
      setAllIntegrations(findValue);
      if (findValue.value === 'all') {
        form.setValue('integrations', []);
      }
    },
    []
  );
  const { data: dataList, isLoading } = useSWR('integrations', integration, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
  const callBack = useCallback(
    async (values: any) => {
      await fetch('/webhooks', {
        method: data?.id ? 'PUT' : 'POST',
        body: JSON.stringify({
          ...(data?.id
            ? {
                id: data.id,
              }
            : {}),
          ...values,
        }),
      });
      toast.show(
        data?.id
          ? t('webhook_updated_successfully', 'Webhook updated successfully')
          : t('webhook_added_successfully', 'Webhook added successfully'),
        'success'
      );
      modal.closeAll();
      reload();
    },
    [data, integrations]
  );
  const sendTest = useCallback(async () => {
    const url = form.getValues('url');
    const chosen = form.getValues('format') as WebhookFormat;
    if (chosen && chosen !== 'GENERIC') {
      // chat bots: the server sends a signed test message and reports what the bot answered
      const res = await fetch('/webhooks/test', {
        method: 'POST',
        body: JSON.stringify({
          ...(data?.id ? { id: data.id } : {}),
          format: chosen,
          url,
          ...(form.getValues('secret') ? { secret: form.getValues('secret') } : {}),
        }),
      });
      const out = await res.json().catch(() => null);
      if (out?.ok) {
        toast.show(t('webhook_test_ok', '测试消息已发到群里'), 'success');
      } else {
        toast.show(
          t('webhook_test_failed_with', '发送失败：{{error}}', {
            error: out?.error || out?.message || res.status,
            interpolation: { escapeValue: false },
          }),
          'warning'
        );
      }
      return;
    }
    toast.show(t('webhook_sent', 'Webhook send'), 'success');
    try {
      await fetch(`/webhooks/send?url=${encodeURIComponent(url)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          {
            id: 'cm6tcts4f0005qcwit25cis26',
            content: t('webhook_test_post_1', '这是发布到 Instagram 的第一条测试帖子'),
            publishDate: '2025-02-06T13:09:00.000Z',
            releaseURL: 'https://facebook.com/release/release',
            state: 'PUBLISHED',
            integration: {
              id: 'cm6s4uyou0001i2r47pxix6z1',
              name: 'test',
              providerIdentifier: 'instagram',
              picture: 'https://oksocial.online/logo.svg',
              type: 'social',
            },
          },
          {
            id: 'cm6tcts4f0005qcwit25cis26',
            content: t('webhook_test_post_2', '这是发布到 Facebook 的第二条测试帖子'),
            publishDate: '2025-02-06T13:09:00.000Z',
            releaseURL: 'https://facebook.com/release2/release2',
            state: 'PUBLISHED',
            integration: {
              id: 'cm6s4uyou0001i2r47pxix6z1',
              name: 'test2',
              providerIdentifier: 'facebook',
              picture: 'https://oksocial.online/logo.svg',
              type: 'social',
            },
          },
        ]),
      });
    } catch (e: any) {
      /** empty **/
    }
  }, [data]);

  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(callBack)}>
        <div className="relative flex gap-[20px] flex-col flex-1 rounded-[4px] pt-0">
          <div>
            <Input
              label="Name"
              translationKey="label_name"
              {...form.register('name')}
            />
            <Select label={t('webhook_format', '发送到')} name="format">
              {WEBHOOK_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {t(`webhook_format_${f.toLowerCase()}`, WEBHOOK_FORMAT_META[f].label)}
                </option>
              ))}
            </Select>
            <p className="text-[12px] text-textItemBlur -mt-[4px] mb-[8px]">{t(`webhook_format_${metaFormat.toLowerCase()}_hint`, meta.hint)}</p>
            <Input
              label="URL"
              translationKey="label_url"
              {...form.register('url')}
            />
            {meta.signed && (
              <Input
                label={t('webhook_secret', '签名密钥（可选）')}
                placeholder={
                  data?.hasSecret
                    ? t('webhook_secret_kept', '已保存，留空则不修改')
                    : t('webhook_secret_placeholder', '机器人开了签名校验时填写')
                }
                type="password"
                autoComplete="off"
                {...form.register('secret')}
              />
            )}
            <label className="flex items-center gap-[10px] my-[12px] cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-[18px] h-[18px] accent-[#612BD3] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                {...form.register('notifications')}
              />
              <span>
                {t(
                  'webhook_forward_notifications',
                  '同时推送站内通知（账号掉线、风控暂停、监控提醒、待审核等）'
                )}
              </span>
            </label>
            <Select
              value={allIntegrations.value}
              name="integrations"
              label="Integrations"
              translationKey="label_integrations"
              disableForm={true}
              onChange={changeIntegration}
            >
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            {allIntegrations.value === 'specific' && dataList && !isLoading && (
              <PickPlatforms
                integrations={dataList.integrations}
                selectedIntegrations={integrations as any[]}
                onChange={(e) => form.setValue('integrations', e)}
                singleSelect={false}
                toolTip={true}
                isMain={true}
              />
            )}
            <div className="flex gap-[10px]">
              <Button
                type="submit"
                className="mt-[24px]"
                disabled={
                  !form.formState.isValid ||
                  (allIntegrations.value === 'specific' &&
                    !integrations?.length)
                }
              >
                {t('save', 'Save')}
              </Button>
              <Button
                type="button"
                secondary={true}
                className="mt-[24px]"
                onClick={sendTest}
                disabled={
                  !form.formState.isValid ||
                  (allIntegrations.value === 'specific' &&
                    !integrations?.length)
                }
              >
                {t('send_test', 'Send Test')}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </FormProvider>
  );
};
