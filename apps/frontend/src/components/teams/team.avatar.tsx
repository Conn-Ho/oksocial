'use client';

import React, { FC, useEffect, useState } from 'react';
import clsx from 'clsx';

const SIZES = {
  sm: 'w-[24px] h-[24px] rounded-[7px] text-[12px]',
  md: 'w-[32px] h-[32px] rounded-[9px] text-[14px]',
  lg: 'w-[72px] h-[72px] rounded-[18px] text-[28px]',
};

/** A team's avatar: its image, or the first letter of its name on the brand tint. */
export const TeamAvatar: FC<{
  name: string;
  avatar?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}> = ({ name, avatar, size = 'md', className }) => {
  // a link that stopped working shows the letter instead of a broken image
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [avatar]);
  const box = clsx('shrink-0 overflow-hidden', SIZES[size], className);
  if (avatar && !broken) {
    return (
      <img
        src={avatar}
        alt=""
        className={clsx(box, 'object-cover ring-1 ring-newBorder')}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span
      aria-hidden={true}
      className={clsx(box, 'flex items-center justify-center font-[700] bg-btnPrimary/10 text-btnPrimary')}
    >
      {Array.from(name.trim())[0]?.toUpperCase() || '·'}
    </span>
  );
};
