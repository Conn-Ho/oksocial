'use client';

import { withContinueProvider } from '../with-continue-provider';

interface YoutubeItem {
  id: string;
  name: string;
  username?: string;
  subscriberCount?: string;
  picture?: {
    data: {
      url: string;
    };
  };
}

interface YoutubeSelection {
  id: string;
}

export const YoutubeContinue = withContinueProvider<
  YoutubeItem,
  YoutubeSelection
>({
  endpoint: 'pages',
  swrKey: 'load-youtube-channels',
  titleKey: 'select_channel',
  titleDefault: '选择 YouTube 频道：',
  emptyStateMessages: [
    {
      key: 'youtube_no_channels_found',
      text: '没有找到与你的账号关联的 YouTube 频道。',
    },
    {
      key: 'youtube_ensure_channel_exists',
      text: '请确认你已经创建了 YouTube 频道。',
    },
    {
      key: 'youtube_try_again',
      text: '请关闭此对话框，删除该频道后重试。',
    },
  ],
  getItemId: (item) => item.id,
  getSelectionValue: (item) => ({ id: item.id }),
  transformSaveData: (selection) => selection,
  isSelected: (item, selection) => selection?.id === item.id,
  renderItem: (item, _isSelected, t) => (
    <>
      <div className="flex justify-center">
        {item.picture?.data?.url ? (
          <img
            className="w-[80px] h-[80px] object-cover rounded-full"
            src={item.picture.data.url}
            alt={item.name}
          />
        ) : (
          <div className="w-[80px] h-[80px] bg-input rounded-full flex items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z" />
              <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" />
            </svg>
          </div>
        )}
      </div>
      <div className="text-sm font-medium">{item.name}</div>
      {item.username && (
        <div className="text-xs text-gray-500">{item.username}</div>
      )}
      {item.subscriberCount && (
        <div className="text-xs text-gray-400">
          {t('youtube_subscribers', '{{n}} 位订阅者', {
            n: parseInt(item.subscriberCount).toLocaleString(),
          })}
        </div>
      )}
    </>
  ),
});
