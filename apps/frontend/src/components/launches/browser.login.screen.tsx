'use client';

import React, { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

/** The account's own browser, live (noVNC): for SMS, captchas and every step oksocial cannot ask for. */
export const BrowserLoginScreen: FC<{ screenPath: string }> = ({ screenPath }) => {
  const t = useT();
  return (
    <div className="relative w-full aspect-[16/10] min-h-[320px] rounded-[8px] overflow-hidden bg-newTableHeader border border-newTableBorder">
      <iframe
        title={t('browser_login_screen', '登录画面')}
        src={screenPath}
        className="absolute inset-0 w-full h-full"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
};
