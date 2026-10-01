'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { PostStatus } from '@gitroom/helpers/posts/posts.manage';
import { ChannelTagRef } from '@gitroom/helpers/utils/channel.tags';

// A row of the 帖子 list (GET /posts/manage).
export type ManagedPost = {
  id: string;
  group: string;
  content: string;
  image: string | null;
  publishDate: string;
  state: 'QUEUE' | 'PUBLISHED' | 'ERROR' | 'DRAFT';
  approval: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
  approvalNote: string | null;
  error: string | null;
  creationMethod: string;
  intervalInDays: number | null;
  releaseURL: string | null;
  createdAt: string;
  integration: {
    id: string;
    name: string;
    picture: string | null;
    providerIdentifier: string;
    disabled: boolean;
  };
};

export type ManagedPostsPage = {
  posts: ManagedPost[];
  total: number;
  page: number;
  pages: number;
  counts: Record<PostStatus, number>;
};

// every 帖子 list query starts with this, so the calendar's reload can refresh them all
export const MANAGED_POSTS_KEY = '/posts/manage';

export const useManagedPosts = (query: string) => {
  const fetch = useFetch();
  const key = `${MANAGED_POSTS_KEY}?${query}`;
  const load = useCallback(async () => (await fetch(key)).json(), [key]);
  return useSWR<ManagedPostsPage>(key, load, { keepPreviousData: true });
};

export const useChannelTags = () => {
  const fetch = useFetch();
  const load = useCallback(async () => (await fetch('/integrations/tags')).json(), []);
  return useSWR<ChannelTagRef[]>('/integrations/tags', load, { revalidateOnFocus: false });
};
