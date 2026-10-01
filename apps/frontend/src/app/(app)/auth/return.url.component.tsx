'use client';

import { useSearchParams } from 'next/navigation';
import { FC, useCallback, useEffect } from 'react';

/** `value` when it is an address of this site (never another site or a script URL), else null. */
const sameSite = (value: string | null) => {
  if (!value || typeof window === 'undefined') {
    return null;
  }
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin && /^https?:$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
};

const ReturnUrlComponent: FC = () => {
  const params = useSearchParams();
  const url = sameSite(params.get('returnUrl'));
  useEffect(() => {
    if (url) {
      localStorage.setItem('returnUrl', url);
    }
  }, [url]);
  return null;
};
export const useReturnUrl = () => {
  return {
    getAndClear: useCallback(() => {
      const data = localStorage.getItem('returnUrl');
      localStorage.removeItem('returnUrl');
      return sameSite(data);
    }, []),
  };
};
export default ReturnUrlComponent;
