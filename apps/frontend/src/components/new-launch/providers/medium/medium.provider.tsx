'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { Input } from '@gitroom/react/form/input';
import { MediumPublications } from '@gitroom/frontend/components/new-launch/providers/medium/medium.publications';
import { MediumTags } from '@gitroom/frontend/components/new-launch/providers/medium/medium.tags';
import { MediumSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/medium.settings.dto';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { Canonical } from '@gitroom/react/form/canonical';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const MediumSettings: FC = () => {
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
      <div>
        <MediumPublications {...form.register('publication')} />
      </div>
      <div>
        <MediumTags
          label={t('label_topics', '话题')}
          {...form.register('tags')}
        />
      </div>
    </>
  );
};
export default withProvider({
  postComment: PostComment.POST,
  minimumCharacters: [],
  SettingsComponent: MediumSettings,
  CustomPreviewComponent: undefined, //MediumPreview,
  dto: MediumSettingsDto,
  maximumCharacters: 100000,
});
