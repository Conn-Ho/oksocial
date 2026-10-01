'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { TwitchDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/twitch.dto';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { Select } from '@gitroom/react/form/select';
import { useWatch } from 'react-hook-form';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const messageTypes = [
  {
    label: '聊天消息',
    value: 'message',
  },
  {
    label: '公告',
    value: 'announcement',
  },
];

const announcementColors = [
  {
    label: '主色（默认）',
    value: 'primary',
  },
  {
    label: '蓝色',
    value: 'blue',
  },
  {
    label: '绿色',
    value: 'green',
  },
  {
    label: '橙色',
    value: 'orange',
  },
  {
    label: '紫色',
    value: 'purple',
  },
];

const TwitchSettings: FC = () => {
  const { register, control } = useSettings();
  const t = useT();
  const messageType = useWatch({
    control,
    name: 'messageType',
  });

  return (
    <div className="flex flex-col">
      <Select
        label={t('message_type', '消息类型')}
        {...register('messageType', {
          value: 'message',
        })}
      >
        {messageTypes.map((item) => (
          <option key={item.value} value={item.value}>
            {t(`twitch_message_type_${item.value}`, item.label)}
          </option>
        ))}
      </Select>
      {messageType === 'announcement' && (
        <Select
          label={t('announcement_color_label', '公告颜色')}
          {...register('announcementColor', {
            value: 'primary',
          })}
        >
          {announcementColors.map((c) => (
            <option key={c.value} value={c.value}>
              {t(`twitch_color_${c.value}`, c.label)}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
};

export default withProvider({
  postComment: PostComment.COMMENT,
  comments: 'no-media',
  minimumCharacters: [],
  SettingsComponent: TwitchSettings,
  CustomPreviewComponent: undefined,
  dto: TwitchDto,
  maximumCharacters: 500,
});
