import i18next from '@gitroom/react/translation/i18next';
import { areYouSure } from '@gitroom/frontend/components/layout/new-modal';

export const deleteDialog = async (
  message: string,
  confirmButton?: string,
  title?: string,
  cancelButton?: string
) => {
  return areYouSure({
    title: title || i18next.t('are_you_sure', '你确定吗？'),
    description: message,
    approveLabel: confirmButton || i18next.t('yes_delete_it', '是的，删除它！'),
    cancelLabel: cancelButton || i18next.t('no_cancel', '不，取消！'),
  });
};
