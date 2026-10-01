'use client';

import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { Input } from '@gitroom/react/form/input';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { TumblrDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/tumblr.dto';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const TumblrSettings = () => {
  const form = useSettings();
  const t = useT();

  return (
    <>
      <Input label="Title" {...form.register('title')} />
      <Input label={t('link_url', '链接 URL')} {...form.register('link')} />
      <Input
        label={t('source_url', '来源 URL')}
        {...form.register('sourceUrl')}
      />
      <Input label="Tags" {...form.register('tags')} />
    </>
  );
};

export default withProvider({
  comments: false,
  postComment: PostComment.POST,
  minimumCharacters: [],
  SettingsComponent: TumblrSettings,
  CustomPreviewComponent: undefined,
  dto: TumblrDto,
  maximumCharacters: 32768,
});
