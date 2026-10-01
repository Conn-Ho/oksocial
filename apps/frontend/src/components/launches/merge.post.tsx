import { Button } from '@gitroom/react/form/button';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { FC, useCallback } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
export const MergePost: FC<{
  merge: () => void;
}> = (props) => {
  const { merge } = props;
  const t = useT();

  const notReversible = useCallback(async () => {
    if (
      await deleteDialog(
        t(
          'confirm_merge_comments',
          '确定要把所有评论合并成一条帖子吗？此操作不可撤销。'
        ),
        t('yes_merge', '确认合并')
      )
    ) {
      merge();
    }
  }, [merge]);
  return (
    <Button className="!h-[30px] !text-sm !bg-red-800" onClick={notReversible}>
      {t('merge_comments_into_one_post', 'Merge comments into one post')}
    </Button>
  );
};
