'use client';

import React, { FC, useState } from 'react';
import { Button } from '@gitroom/react/form/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { CheckinStatus, usePost } from '@gitroom/frontend/components/usage/usage.hooks';

/** 签到送积分: once a day per member, the organization gets the credits; shows the streak. */
export const CheckinButton: FC<{ status: CheckinStatus; onDone: () => void }> = ({ status, onDone }) => {
  const t = useT();
  const post = usePost();
  const toaster = useToaster();
  const [busy, setBusy] = useState(false);
  if (!status.enabled) {
    return null;
  }

  const checkIn = async () => {
    setBusy(true);
    const res = await post<CheckinStatus & { added: boolean }>('/usage/checkin');
    setBusy(false);
    if (!res.ok) {
      toaster.show(res.message || t('checkin_failed', '签到失败，请稍后再试'), 'warning');
      return;
    }
    toaster.show(
      res.data!.added
        ? t('checkin_done', '签到成功，团队 +{{n}} 积分', { n: res.data!.credits })
        : t('checkin_already', '今天已经签到过了'),
      'success'
    );
    onDone();
  };

  return (
    <div className="flex items-center gap-[10px] flex-wrap">
      <Button secondary={true} disabled={status.checkedInToday} loading={busy} onClick={checkIn} className="!h-[34px] !px-[14px] !text-[13px]">
        {status.checkedInToday ? t('checkin_today_done', '今日已签到') : t('checkin_action', '签到 +{{n}}', { n: status.credits })}
      </Button>
      <span className="text-[12px] text-textItemBlur">
        {status.streak > 0
          ? t('checkin_streak', '已连续签到 {{n}} 天', { n: status.streak })
          : t('checkin_hint', '每位成员每天签到一次，积分归团队')}
      </span>
    </div>
  );
};
