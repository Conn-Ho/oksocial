'use client';

import { withContinueProvider } from '../with-continue-provider';

interface TumblrBlogItem {
  id: string;
  name: string;
  username?: string;
  followers?: number;
  primary?: boolean;
  picture?: {
    data: {
      url: string;
    };
  };
}

interface TumblrBlogSelection {
  id: string;
}

export const TumblrContinue = withContinueProvider<
  TumblrBlogItem,
  TumblrBlogSelection
>({
  endpoint: 'pages',
  swrKey: 'load-tumblr-blogs',
  titleKey: 'select_tumblr_blog',
  titleDefault: '选择 Tumblr 博客：',
  emptyStateMessages: [
    {
      key: 'tumblr_no_blogs_found',
      text: '没有找到与你的账号关联的 Tumblr 博客。',
    },
    {
      key: 'tumblr_ensure_blog_exists',
      text: '请确认你的 Tumblr 账号下有可以发布内容的博客。',
    },
    {
      key: 'tumblr_try_again',
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
          <div className="w-[80px] h-[80px] bg-input rounded-full flex items-center justify-center text-[32px] font-semibold">
            t
          </div>
        )}
      </div>
      <div className="text-sm font-medium">{item.name}</div>
      {item.username && (
        <div className="text-xs text-gray-500 break-all">{item.username}</div>
      )}
      {!!item.followers && (
        <div className="text-xs text-gray-400">
          {t('tumblr_followers', '{{n}} 位关注者', {
            n: item.followers.toLocaleString(),
          })}
        </div>
      )}
      {item.primary && (
        <div className="text-xs text-gray-400">
          {t('tumblr_primary_blog', '主博客')}
        </div>
      )}
    </>
  ),
});
