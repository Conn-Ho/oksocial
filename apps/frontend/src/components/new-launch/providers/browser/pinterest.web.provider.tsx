'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { PinterestBoard } from '@gitroom/frontend/components/new-launch/providers/pinterest/pinterest.board';
import { PinterestSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/pinterest.dto';
import { Input } from '@gitroom/react/form/input';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// Pinterest browser channel: the board (the account's boards, read in its browser), title and link.
const PinterestWebSettings: FC = () => {
  const { register } = useSettings();
  const t = useT();
  return (
    <div className="flex flex-col">
      <Input label={t('title', '标题')} {...register('title')} />
      <Input label={t('link', '链接')} {...register('link')} />
      <PinterestBoard {...register('board')} />
    </div>
  );
};

export default withProvider({
  postComment: PostComment.POST,
  minimumCharacters: [],
  SettingsComponent: PinterestWebSettings,
  CustomPreviewComponent: undefined,
  dto: PinterestSettingsDto,
  maximumCharacters: 500,
});
