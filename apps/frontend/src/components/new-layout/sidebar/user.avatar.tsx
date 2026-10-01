'use client';

import React, { FC, useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { userDisplayName, userInitials } from '@gitroom/helpers/utils/sidebar.account';
import { useUser } from '@gitroom/frontend/components/layout/user.context';

/** 个人资料 (GET /user/personal): /user/self has no picture path. */
type Personal = { id: string; name: string | null; picture: { id: string; path: string } | null };

// changes only when the member saves the profile, and the settings page revalidates it then
const STATIC = {
  revalidateIfStale: false,
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  refreshWhenHidden: false,
  refreshWhenOffline: false,
};

export const PERSONAL_KEY = '/user/personal';

/** The signed-in member as the account card shows them: name, email and picture. */
export const useAccountIdentity = () => {
  const fetch = useFetch();
  const user = useUser();
  const load = useCallback(async () => {
    const res = await fetch(PERSONAL_KEY);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as Personal;
  }, []);
  // without the profile the card still shows the name from /user/self and the letters
  const { data: personal } = useSWR<Personal>(PERSONAL_KEY, load, { ...STATIC, shouldRetryOnError: false });
  const email = user?.email || '';
  const name = personal?.name?.trim()
    ? userDisplayName({ name: personal.name, email })
    : userDisplayName({ name: user?.name, lastName: user?.lastName, email });
  return { name, email, picture: personal?.picture?.path || null };
};

const SIZES = {
  sm: 'w-[28px] h-[28px] text-[12px]',
  md: 'w-[36px] h-[36px] text-[14px]',
};

/** A member's round avatar: the picture, or the name's letters on the brand tint. */
export const UserAvatar: FC<{ name: string; src: string | null; size?: keyof typeof SIZES }> = ({
  name,
  src,
  size = 'sm',
}) => {
  // a picture that stopped loading shows the letters instead of a broken image
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  const box = clsx('shrink-0 rounded-full overflow-hidden', SIZES[size]);
  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        className={clsx(box, 'object-cover ring-1 ring-newBorder')}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span aria-hidden={true} className={clsx(box, 'flex items-center justify-center font-[700] bg-btnPrimary/10 text-btnPrimary')}>
      {userInitials(name)}
    </span>
  );
};
