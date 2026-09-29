'use client';

import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';

// Browser channel: single posts, no provider-specific settings yet.
export default withProvider({
  postComment: PostComment.POST,
  minimumCharacters: [],
  SettingsComponent: null,
  CustomPreviewComponent: undefined,
  dto: undefined,
  maximumCharacters: 2000,
});
