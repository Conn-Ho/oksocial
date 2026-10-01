'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { Input } from '@gitroom/react/form/input';
import { HashnodePublications } from '@gitroom/frontend/components/new-launch/providers/hashnode/hashnode.publications';
import { HashnodeTags } from '@gitroom/frontend/components/new-launch/providers/hashnode/hashnode.tags';
import { HashnodeSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/hashnode.settings.dto';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import clsx from 'clsx';
import { MediaComponent } from '@gitroom/frontend/components/media/media.component';
import { Canonical } from '@gitroom/react/form/canonical';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const HashnodeSettings: FC = () => {
  const form = useSettings();
  const { date } = useIntegration();
  const t = useT();
  return (
    <>
      <Input label="Title" {...form.register('title')} />
      <Input label="Subtitle" {...form.register('subtitle')} />
      <Canonical
        date={date}
        label="Canonical Link"
        {...form.register('canonical')}
      />
      <MediaComponent
        label={t('label_cover_picture', '封面图片')}
        description={t('add_a_cover_picture', '添加封面图片')}
        {...form.register('main_image')}
      />
      <div className="mt-[20px]">
        <HashnodePublications {...form.register('publication')} />
      </div>
      <div>
        <HashnodeTags
          label={t('label_tags', '标签')}
          {...form.register('tags')}
        />
      </div>
    </>
  );
};
export default withProvider({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: HashnodeSettings,
  CustomPreviewComponent: undefined, // HashnodePreview,
  dto: HashnodeSettingsDto,
  maximumCharacters: 10000,
});
