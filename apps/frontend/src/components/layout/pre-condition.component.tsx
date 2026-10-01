import React, { FC, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { ModalWrapperComponent } from '@gitroom/frontend/components/new-launch/modal.wrapper.component';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Button } from '@gitroom/react/form/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const PreConditionComponentModal: FC = () => {
  const modal = useModals();
  const t = useT();
  return (
    <div className="flex flex-col gap-[16px]">
      <div className="whitespace-pre-line">
        {t(
          'precondition_channel_used_before',
          '这个社交账号之前已连接过另一个 oksocial 账户。\n如需继续，请提前结束试用并立即扣款。\n\n** 请注意：此笔扣款为最终扣款，不支持退款。'
        )}
      </div>
      <div className="flex gap-[2px] justify-center">
        <Button
          onClick={() => (window.location.href = '/billing?finishTrial=true')}
        >
          {t('fast_track_charge_now', '提前结束试用，立即扣款')}
        </Button>
        <Button onClick={modal.closeCurrent} secondary={true}>
          {t('cancel', '取消')}
        </Button>
      </div>
    </div>
  );
};
export const PreConditionComponent: FC = () => {
  const modal = useModals();
  const query = useSearchParams();
  const t = useT();
  useEffect(() => {
    if (query.get('precondition')) {
      modal.openModal({
        title: t('suspicious_activity_detected', '检测到异常操作'),
        withCloseButton: true,
        classNames: {
          modal: 'text-textColor',
        },
        children: <PreConditionComponentModal />,
      });
    }
  }, []);
  return null;
};
