'use client';

import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import PinterestWebProvider from '@gitroom/frontend/components/new-launch/providers/browser/pinterest.web.provider';

// Browser channels added together: single posts, no platform-specific settings yet.
const single = (maximumCharacters: number) =>
  withProvider({
    postComment: PostComment.POST,
    minimumCharacters: [],
    SettingsComponent: null,
    CustomPreviewComponent: undefined,
    dto: undefined,
    maximumCharacters,
  });

export const BROWSER_CHANNEL_EDITORS = [
  { identifier: 'shipinhao', component: single(1000) },
  { identifier: 'bilibili', component: single(2000) },
  { identifier: 'zhihu', component: single(20000) },
  { identifier: 'jike', component: single(2000) },
  { identifier: 'toutiao', component: single(5000) },
  { identifier: 'instagramweb', component: single(2200) },
  { identifier: 'facebookweb', component: single(5000) },
  { identifier: 'tiktokweb', component: single(2200) },
  { identifier: 'youtubeweb', component: single(5000) },
  { identifier: 'linkedinweb', component: single(3000) },
  { identifier: 'redditweb', component: single(10000) },
  { identifier: 'pinterestweb', component: PinterestWebProvider },
  // the first line is the article title
  { identifier: 'gongzhonghao', component: single(20000) },
];
