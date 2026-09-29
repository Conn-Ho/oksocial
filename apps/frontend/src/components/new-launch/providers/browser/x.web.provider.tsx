'use client';

import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { ThreadFinisher } from '@gitroom/frontend/components/new-launch/finisher/thread.finisher';

const SettingsComponent = () => {
  return <ThreadFinisher />;
};

// X through the hosted browser: threads are posted as replies to the previous part.
export default withProvider({
  postComment: PostComment.ALL,
  minimumCharacters: [],
  SettingsComponent: SettingsComponent,
  CustomPreviewComponent: undefined,
  dto: undefined,
  maximumCharacters: 280,
});
