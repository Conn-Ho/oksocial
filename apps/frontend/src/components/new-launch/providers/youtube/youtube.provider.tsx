'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { YoutubeSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/youtube.settings.dto';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { Input } from '@gitroom/react/form/input';
import { MediumTags } from '@gitroom/frontend/components/new-launch/providers/medium/medium.tags';
import { MediaComponent } from '@gitroom/frontend/components/media/media.component';
import { Select } from '@gitroom/react/form/select';
import { YoutubePreview } from '@gitroom/frontend/components/new-launch/providers/youtube/youtube.preview';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
const type = [
  {
    label: '公开',
    value: 'public',
  },
  {
    label: '私享',
    value: 'private',
  },
  {
    label: '不公开列出',
    value: 'unlisted',
  },
];

const madeForKids = [
  {
    label: '否',
    value: 'no',
  },
  {
    label: '是',
    value: 'yes',
  },
];
const YoutubeSettings: FC = () => {
  const { register, control } = useSettings();
  const t = useT();
  return (
    <div className="flex flex-col">
      <Input label="Title" {...register('title')} maxLength={100} />
      <Select
        label="Type"
        {...register('type', {
          value: 'public',
        })}
      >
        {type.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </Select>
      <Select
        label={t('made_for_kids', '面向儿童')}
        {...register('selfDeclaredMadeForKids', {
          value: 'no',
        })}
      >
        {madeForKids.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </Select>
      <MediumTags label={t('label_tags', '标签')} {...register('tags')} />
      <div className="mt-[20px]">
        <MediaComponent
          type="image"
          width={1280}
          height={720}
          label={t('label_thumbnail', '缩略图')}
          description={t('thumbnail_optional', '缩略图（可选）')}
          {...register('thumbnail')}
        />
      </div>
    </div>
  );
};
export default withProvider({
  postComment: PostComment.COMMENT,
  comments: false,
  minimumCharacters: [],
  SettingsComponent: YoutubeSettings,
  CustomPreviewComponent: YoutubePreview,
  dto: YoutubeSettingsDto,
  maximumCharacters: 5000,
});
