'use client';

import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { FC } from 'react';
import { MeweDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/mewe.dto';
import { MeweGroupSelect } from '@gitroom/frontend/components/new-launch/providers/mewe/mewe.group.select';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { Select } from '@gitroom/react/form/select';
import { useWatch } from 'react-hook-form';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const MeweComponent: FC = () => {
  const form = useSettings();
  const t = useT();
  const postType = useWatch({ control: form.control, name: 'postType' });

  return (
    <div>
      <Select
        label={t('post_to', '发布到')}
        {...form.register('postType')}
      >
        <option value="timeline">{t('my_timeline', '我的动态')}</option>
        <option value="group">{t('group', '群组')}</option>
      </Select>
      {postType === 'group' && (
        <MeweGroupSelect {...form.register('group')} />
      )}
    </div>
  );
};

export default withProvider({
  postComment: PostComment.POST,
  comments: false,
  minimumCharacters: [],
  SettingsComponent: MeweComponent,
  CustomPreviewComponent: undefined,
  dto: MeweDto,
  maximumCharacters: 63206,
});
