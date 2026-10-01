import { Button } from '@gitroom/react/form/button';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { FC, useCallback } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
export const SeparatePost: FC<{
  posts: string[];
  len: number;
  merge: (posts: string[]) => void;
  changeLoading: (loading: boolean) => void;
}> = (props) => {
  const { len, posts } = props;
  const t = useT();
  const fetch = useFetch();

  const notReversible = useCallback(async () => {
    if (
      await deleteDialog(
        t(
          'confirm_separate_posts',
          '确定要把内容拆分成多条帖子吗？此操作不可撤销。'
        ),
        t('yes_separate', '确认拆分')
      )
    ) {
      props.changeLoading(true);
      const merge = props.posts.join('\n');
      const { posts } = await (
        await fetch('/posts/separate-posts', {
          method: 'POST',
          body: JSON.stringify({
            content: merge,
            len: props.len,
          }),
        })
      ).json();

      props.merge(posts);
      props.changeLoading(false);
    }
  }, [len, posts]);

  return (
    <Button className="!h-[30px] !text-sm !bg-red-800" onClick={notReversible}>
      {t('separate_post', 'Separate post to multiple posts')}
    </Button>
  );
};
