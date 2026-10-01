'use client';

import { OkLogo, OkMark } from '@gitroom/frontend/components/ui/ok.mark';

// oksocial mark (see ok.mark.tsx)
export const Logo = () => <OkMark size={48} className="mt-[8px] min-w-[48px] min-h-[48px]" />;

/** The sidebar brand: the mark and the wordmark. */
export const Brand = () => (
  <div className="flex items-center h-[40px] px-[8px]">
    <OkLogo size={28} />
  </div>
);
