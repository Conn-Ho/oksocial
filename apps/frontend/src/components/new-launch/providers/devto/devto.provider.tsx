'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { DevToSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/dev.to.settings.dto';
import { Input } from '@gitroom/react/form/input';
import { MediaComponent } from '@gitroom/frontend/components/media/media.component';
import { SelectOrganization } from '@gitroom/frontend/components/new-launch/providers/devto/select.organization';
import { DevtoTags } from '@gitroom/frontend/components/new-launch/providers/devto/devto.tags';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import clsx from 'clsx';
import { Canonical } from '@gitroom/react/form/canonical';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const DevtoSettings: FC = () => {
  const form = useSettings();
  const { date } = useIntegration();
  const t = useT();
  return (
    <>
      <Input label="Title" {...form.register('title')} />
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
        <SelectOrganization {...form.register('organization')} />
      </div>
      <div>
        <DevtoTags
          label={t('label_tags_maximum_4', '标签（最多4个）')}
          {...form.register('tags', {
            value: [],
          })}
        />
      </div>
    </>
  );
};
export default withProvider({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: DevtoSettings,
  CustomPreviewComponent: undefined, // DevtoPreview,
  dto: DevToSettingsDto,
  maximumCharacters: 100000,
});
