'use client';

import React, { FC, useCallback, useState } from 'react';
import { object, string } from 'yup';
import { FormProvider, useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { errorMessage } from '@gitroom/frontend/components/teams/teams.hooks';

export const TEAM_NAME_MAX = 60;

export const teamNameRule = (t: ReturnType<typeof useT>) =>
  string()
    .trim()
    .required(t('team_name_required', '请输入团队名称'))
    .max(TEAM_NAME_MAX, t('team_name_too_long', '团队名称最多 60 个字'));

const CreateTeamForm: FC = () => {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const [saving, setSaving] = useState(false);
  const form = useForm({
    resolver: yupResolver(object({ name: teamNameRule(t) })),
    defaultValues: { name: '' },
  });

  const submit = useCallback(async ({ name }: { name?: string }) => {
    setSaving(true);
    const res = await fetch('/user/organizations', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      setSaving(false);
      toaster.show(await errorMessage(res, t('team_create_failed', '没能创建团队，请重试')), 'warning');
      return;
    }
    // the session is in the new team now: start from its (empty) calendar
    window.location.href = '/';
  }, []);

  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-[12px] w-full max-w-[440px]">
        <p className="text-[13px] text-textItemBlur leading-[1.6]">
          {t(
            'team_create_intro',
            '每个团队有自己的社媒账号、品牌资料、成员和套餐，适合给每个客户单独建一个团队。新团队从免费版开始，创建后会切换过去。'
          )}
        </p>
        <Input
          label={t('team_name', '团队名称')}
          name="name"
          placeholder={t('team_name_placeholder', '例如：客户 A')}
          maxLength={TEAM_NAME_MAX}
          autoFocus={true}
          autoComplete="off"
        />
        <div className="flex justify-end">
          <Button type="submit" loading={saving}>
            {t('team_create_submit', '创建并切换')}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
};

/** Opens 创建团队 (from the team menu and the team settings). */
export const useCreateTeam = () => {
  const modals = useModals();
  const t = useT();
  return useCallback(() => {
    modals.openModal({
      title: t('team_create', '创建团队'),
      withCloseButton: true,
      children: <CreateTeamForm />,
    });
  }, [t]);
};
