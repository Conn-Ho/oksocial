'use client';

import React, { FC, FormEvent, useCallback, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { errorMessage, TeamInfo } from '@gitroom/frontend/components/teams/teams.hooks';

/** 删除团队: what goes with the team, and its name typed again before the button unlocks. */
const DeleteTeamForm: FC<{ team: TeamInfo }> = ({ team }) => {
  const fetch = useFetch();
  const modals = useModals();
  const toaster = useToaster();
  const t = useT();
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const confirmed = typed.trim() === team.name.trim();
  const others = Math.max(0, team.members - 1);

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!confirmed || deleting) {
        return;
      }
      setDeleting(true);
      const res = await fetch('/user/organizations/current', {
        method: 'DELETE',
        body: JSON.stringify({ name: typed }),
      });
      if (!res.ok) {
        setDeleting(false);
        toaster.show(await errorMessage(res, t('team_delete_failed', '没能删除团队，请重试')), 'warning');
        return;
      }
      // the session moved to another of the user's teams
      window.location.href = '/';
    },
    [confirmed, deleting, typed]
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-[16px] w-full max-w-[460px]">
      <div className="flex flex-col gap-[8px]">
        <p className="text-[14px] text-textColor leading-[1.6]">
          {t('team_delete_lead', '删除后无法恢复，这个团队的：')}
        </p>
        <ul className="flex flex-col gap-[6px] ps-[18px] list-disc text-[13px] text-textItemBlur leading-[1.6]">
          <li>{t('team_delete_channels', '社媒账号全部移除，账号浏览器里的登录会被清除')}</li>
          <li>{t('team_delete_runs', '定时帖子取消，自动化、监控和自动发帖停止')}</li>
          <li>{t('team_delete_billing', '剩余的套餐时长和积分不退还')}</li>
          {others > 0 && (
            <li>{t('team_delete_members', '另外 {{count}} 位成员将无法再进入这个团队', { count: others })}</li>
          )}
        </ul>
      </div>
      <label className="flex flex-col gap-[6px]">
        <span className="text-[13px] font-[600] text-textColor">
          {t('team_delete_confirm_label', '输入团队名称「{{name}}」确认删除', { name: team.name })}
        </span>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoFocus={true}
          autoComplete="off"
          aria-invalid={!!typed && !confirmed}
          placeholder={team.name}
          className="h-[42px] px-[16px] rounded-[8px] bg-newBgColorInner border border-newTableBorder text-[14px] text-textColor placeholder:text-textItemBlur outline-none transition-[border-color,box-shadow] duration-150 focus:border-btnPrimary focus:ring-[3px] focus:ring-btnPrimary/15"
        />
      </label>
      <div className="flex justify-end gap-[8px]">
        <Button secondary={true} onClick={() => modals.closeCurrent()} disabled={deleting}>
          {t('cancel', '取消')}
        </Button>
        <Button type="submit" disabled={!confirmed} loading={deleting} className="!bg-red-600 hover:!bg-red-700">
          {t('team_delete', '删除团队')}
        </Button>
      </div>
    </form>
  );
};

export const useDeleteTeam = () => {
  const modals = useModals();
  const t = useT();
  return useCallback(
    (team: TeamInfo) => {
      modals.openModal({
        title: t('team_delete_title', '删除团队「{{name}}」', { name: team.name }),
        withCloseButton: true,
        children: <DeleteTeamForm team={team} />,
      });
    },
    [t]
  );
};
