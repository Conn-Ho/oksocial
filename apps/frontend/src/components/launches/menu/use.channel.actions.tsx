'use client';

import React, { useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import copy from 'copy-to-clipboard';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import { TimeTable } from '@gitroom/frontend/components/launches/time.table';
import { BotPicture } from '@gitroom/frontend/components/launches/bot.picture';
import { CustomerModal } from '@gitroom/frontend/components/launches/customer.modal';
import { SettingsModal } from '@gitroom/frontend/components/launches/settings.modal';
import { CustomVariables } from '@gitroom/frontend/components/launches/add.provider.component';
import { BrowserProxyModal } from '@gitroom/frontend/components/launches/browser.proxy.modal';
import { BrowserLoginModal } from '@gitroom/frontend/components/launches/browser.login.modal';
import { ChannelTagsModal } from '@gitroom/frontend/components/launches/channel.tags.modal';

/** A channel as GET /integrations/list (and /integrations/accounts) return it. */
export type ChannelActionTarget = Integrations & {
  internalId: string;
  refreshNeeded?: boolean;
  isCustomFields?: boolean;
  isBrowserSession?: boolean;
  customFields?: any[];
};

/**
 * What can be done to a channel, shared by the calendar's channel menu and the 账号 page: the API
 * calls and the dialogs. `mutate` reloads the list a dialog changed; `onChange` follows a change of
 * the channel itself (true: it is gone, reload everything).
 */
export const useChannelActions = ({
  mutate,
  onChange,
}: {
  mutate: () => void;
  onChange: (shouldReload: boolean) => void;
}) => {
  const t = useT();
  const fetch = useFetch();
  const router = useRouter();
  const toast = useToaster();
  const modal = useModals();
  const { extensionId } = useVariables();

  // a browser channel logs in again in its own browser, a custom-fields one re-enters its
  // credentials, an OAuth one goes through the platform again
  const reconnect = useCallback(
    async (integration: ChannelActionTarget) => {
      if (integration.isBrowserSession) {
        modal.openModal({
          title: t('browser_login_reconnect', '重新登录 {{name}}', {
            name: integration.name,
          }),
          withCloseButton: true,
          classNames: {
            modal: 'bg-transparent text-textColor w-[980px] max-w-[95vw]',
          },
          children: (
            <BrowserLoginModal
              identifier={integration.identifier}
              name={integration.name}
              integrationId={integration.id}
              onConnected={() => {
                mutate();
                router.refresh();
              }}
            />
          ),
        });
        return;
      }
      if (integration.isCustomFields) {
        modal.openModal({
          title: t('custom_url', 'Custom URL'),
          withCloseButton: false,
          classNames: {
            modal: 'md',
          },
          children: (
            <CustomVariables
              identifier={integration.identifier}
              gotoUrl={(url: string) => router.push(url)}
              variables={integration.customFields || []}
            />
          ),
        });
        return;
      }
      const { url } = await (
        await fetch(
          `/integrations/social/${integration.identifier}?refresh=${integration.internalId}`,
          {
            method: 'GET',
          }
        )
      ).json();
      window.location.href = url;
    },
    [mutate, t]
  );

  const disable = useCallback(
    async (integration: ChannelActionTarget) => {
      if (
        !(await deleteDialog(
          t('are_you_sure_disable_channel', 'Are you sure you want to disable this channel?'),
          t('disable_channel_title', 'Disable Channel')
        ))
      ) {
        return;
      }
      await fetch('/integrations/disable', {
        method: 'POST',
        body: JSON.stringify({
          id: integration.id,
        }),
      });
      toast.show(t('channel_disabled', 'Channel Disabled'), 'success');
      onChange(false);
    },
    [onChange, t]
  );

  const enable = useCallback(
    async (integration: ChannelActionTarget) => {
      const res = await fetch('/integrations/enable', {
        method: 'POST',
        body: JSON.stringify({
          id: integration.id,
        }),
      });
      if (!res.ok) {
        // 402 (the plan's enabled channels are used up) already asked to upgrade
        if (res.status !== 402) {
          const body = await res.json().catch(() => ({}));
          toast.show(body?.message || t('channel_enable_failed', '启用失败，请稍后再试'), 'warning');
        }
        return;
      }
      toast.show(t('channel_enabled', 'Channel Enabled'), 'success');
      onChange(false);
    },
    [onChange, t]
  );

  const remove = useCallback(
    async (integration: ChannelActionTarget) => {
      if (
        !(await deleteDialog(
          t('are_you_sure_delete_channel', 'Are you sure you want to delete this channel?'),
          t('delete_channel_title', 'Delete Channel')
        ))
      ) {
        return;
      }
      const deleteIntegration = await fetch('/integrations', {
        method: 'DELETE',
        body: JSON.stringify({
          id: integration.id,
        }),
      });
      if (deleteIntegration.status === 406) {
        toast.show(
          t('delete_posts_before_channel', 'You have to delete all the posts associated with this channel before deleting it'),
          'warning'
        );
        return;
      }
      // Clean up extension refresh token if applicable
      if (extensionId && typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage) {
        try {
          chrome.runtime.sendMessage(
            extensionId,
            { type: 'REMOVE_REFRESH_TOKEN', integrationId: integration.id },
            () => {
              if (chrome.runtime.lastError) {
                return;
              }
            }
          );
        } catch {
          // Silently ignore
        }
      }
      toast.show(t('channel_deleted', 'Channel Deleted'), 'success');
      onChange(true);
    },
    [onChange, extensionId, t]
  );

  const timeTable = useCallback(
    (integration: ChannelActionTarget) => {
      modal.openModal({
        withCloseButton: true,
        closeOnEscape: false,
        closeOnClickOutside: false,
        askClose: true,
        title: t('time_table_slots', 'Time Table Slots'),
        children: <TimeTable integration={integration} mutate={mutate} />,
      });
    },
    [mutate, t]
  );

  const copyId = useCallback(
    (integration: ChannelActionTarget) => {
      copy(integration.id);
      toast.show(t('channel_id_copied', 'Channel ID copied to clipboard'), 'success');
    },
    [t]
  );

  const botPicture = useCallback(
    (integration: ChannelActionTarget) => {
      modal.openModal({
        classNames: {
          modal: 'w-[100%] max-w-[600px] bg-transparent text-textColor',
        },
        size: '100%',
        withCloseButton: false,
        closeOnEscape: true,
        closeOnClickOutside: true,
        children: (
          <BotPicture
            canChangeProfilePicture={integration.changeProfilePicture}
            canChangeNickName={integration.changeNickName}
            integration={integration}
            mutate={mutate}
          />
        ),
      });
    },
    [mutate]
  );

  const additionalSettings = useCallback(
    (integration: ChannelActionTarget) => {
      modal.openModal({
        title: t('additional_settings', 'Additional Settings'),
        children: (
          <SettingsModal
            // @ts-ignore the list row carries what the dialog reads (id, additionalSettings)
            integration={integration}
            onClose={() => {
              mutate();
              toast.show(t('settings_updated', 'Settings Updated'), 'success');
            }}
          />
        ),
      });
    },
    [mutate, t]
  );

  const customer = useCallback(
    (integration: ChannelActionTarget) => {
      modal.openModal({
        classNames: {
          modal: 'md',
        },
        title: t('move_add_to_group', 'Move / Add to group'),
        withCloseButton: false,
        closeOnEscape: true,
        closeOnClickOutside: true,
        children: (
          <CustomerModal
            // @ts-ignore the list row carries what the dialog reads (id, customer)
            integration={integration}
            onClose={() => {
              mutate();
              toast.show(t('customer_updated', 'Customer Updated'), 'success');
            }}
          />
        ),
      });
    },
    [mutate, t]
  );

  // 添加标签: a channel can carry several tags (the channel list and the editor filter by them)
  const tags = useCallback(
    (integration: ChannelActionTarget) => {
      modal.openModal({
        title: t('channel_tags_title', '账号标签'),
        withCloseButton: true,
        classNames: {
          modal: 'bg-transparent text-textColor w-[560px] max-w-[95vw]',
        },
        children: (close: () => void) => (
          <ChannelTagsModal integration={integration} close={close} onSaved={() => mutate()} />
        ),
      });
    },
    [mutate, t]
  );

  // 出口代理: `current` preselects the bound proxy when the caller knows it
  const proxy = useCallback(
    (integration: ChannelActionTarget, current?: string | null) => {
      modal.openModal({
        title: t('browser_proxies', '出口代理'),
        withCloseButton: true,
        children: <BrowserProxyModal integrationId={integration.id} current={current} onSaved={mutate} />,
      });
    },
    [mutate, t]
  );

  // the platform's second site (小红书网页版: DMs, notifications) has its own login in the same browser
  const webLogin = useCallback(
    (integration: ChannelActionTarget) => {
      modal.openModal({
        title: t('browser_web_title', '登录网页版：{{name}}', { name: integration.name }),
        withCloseButton: true,
        classNames: {
          modal: 'bg-transparent text-textColor w-[980px] max-w-[95vw]',
        },
        children: (
          <BrowserLoginModal
            identifier={integration.identifier}
            name={integration.name}
            integrationId={integration.id}
            mode="web"
            onConnected={() => mutate()}
          />
        ),
      });
    },
    [mutate, t]
  );

  const updateCredentials = useCallback(
    (integration: ChannelActionTarget) => {
      modal.openModal({
        title: t('custom_url', 'Custom URL'),
        withCloseButton: false,
        classNames: {
          modal: 'md',
        },
        children: (
          <CustomVariables
            identifier={integration.identifier}
            gotoUrl={(url: string) => router.push(url)}
            variables={integration.customFields || []}
          />
        ),
      });
    },
    [t]
  );

  return useMemo(
    () => ({
      reconnect,
      disable,
      enable,
      remove,
      timeTable,
      copyId,
      botPicture,
      additionalSettings,
      customer,
      tags,
      proxy,
      webLogin,
      updateCredentials,
    }),
    [reconnect, disable, enable, remove, timeTable, copyId, botPicture, additionalSettings, customer, tags, proxy, webLogin, updateCredentials]
  );
};
