'use client';

import { MediaDrive } from '@gitroom/frontend/components/media/media.drive';

export const MediaLayoutComponent = () => {
  return (
    <div className="bg-newBgColorInner p-[16px] md:p-[20px] flex flex-1 flex-col gap-[15px] transition-all min-w-0">
      <MediaDrive />
    </div>
  );
};
