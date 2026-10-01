'use client';

import React, { ReactNode, useCallback, useEffect } from 'react';
import { Brand } from '@gitroom/frontend/components/new-layout/logo';
const ModeComponent = dynamic(
  () => import('@gitroom/frontend/components/layout/mode.component'),
  {
    ssr: false,
  }
);

import clsx from 'clsx';
import dynamic from 'next/dynamic';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { CheckPayment } from '@gitroom/frontend/components/layout/check.payment';
import { ToolTip } from '@gitroom/frontend/components/layout/top.tip';
import { ShowMediaBoxModal } from '@gitroom/frontend/components/media/media.component';
import { ShowLinkedinCompany } from '@gitroom/frontend/components/launches/helpers/linkedin.component';
import { MediaSettingsLayout } from '@gitroom/frontend/components/launches/helpers/media.settings.component';
import { Toaster } from '@gitroom/react/toaster/toaster';
import { ShowPostSelector } from '@gitroom/frontend/components/post-url-selector/post.url.selector';
import { NewSubscription } from '@gitroom/frontend/components/layout/new.subscription';
import { Support } from '@gitroom/frontend/components/layout/support';
import { ContinueProvider } from '@gitroom/frontend/components/layout/continue.provider';
import { ContextWrapper } from '@gitroom/frontend/components/layout/user.context';
import { CopilotKit } from '@copilotkit/react-core';
import { MantineWrapper } from '@gitroom/react/helpers/mantine.wrapper';
import { Impersonate } from '@gitroom/frontend/components/layout/impersonate';
import { AnnouncementBanner } from '@gitroom/frontend/components/layout/announcement.banner';
import { Title } from '@gitroom/frontend/components/layout/title';
import { TopMenu } from '@gitroom/frontend/components/layout/top.menu';
import { LanguageComponent } from '@gitroom/frontend/components/layout/language.component';
import { ChromeExtensionComponent } from '@gitroom/frontend/components/layout/chrome.extension.component';
import NotificationComponent from '@gitroom/frontend/components/notifications/notification.component';
import { OrganizationSelector } from '@gitroom/frontend/components/layout/organization.selector';
import { StreakComponent } from '@gitroom/frontend/components/layout/streak.component';
import { PreConditionComponent } from '@gitroom/frontend/components/layout/pre-condition.component';
import { AttachToFeedbackIcon } from '@gitroom/frontend/components/new-layout/sentry.feedback.component';
import { FirstBillingComponent } from '@gitroom/frontend/components/billing/first.billing.component';
import { TrialTracker } from '@gitroom/frontend/components/layout/gtm.component';
import { MobileNav } from '@gitroom/frontend/components/new-layout/mobile.nav';
import { SetupChecklist } from '@gitroom/frontend/components/onboarding/setup.checklist';
import { QuickCreate } from '@gitroom/frontend/components/layout/quick.create';
import { setSentryUser } from '@gitroom/react/sentry/initialize.sentry.client';


export const LayoutComponent = ({ children }: { children: ReactNode }) => {
  const fetch = useFetch();
  const t = useT();

  const { backendUrl, billingEnabled, isGeneral } = useVariables();

  // Feedback icon component attaches Sentry feedback to a top-bar icon when DSN is present
  const searchParams = useSearchParams();
  const load = useCallback(async (path: string) => {
    return await (await fetch(path)).json();
  }, []);
  const { data: user, mutate } = useSWR('/user/self', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenOffline: false,
    refreshWhenHidden: false,
  });

  useEffect(() => {
    setSentryUser(
      user ? { id: user.id, email: user.email, orgId: user.orgId } : null
    );
  }, [user]);

  if (!user) return null;

  // a free org on the hosted plan only sees the plan picker: no menu, so no phone bar either
  const firstBilling = user.tier === 'FREE' && isGeneral && billingEnabled;

  return (
    <ContextWrapper user={user}>
      <CopilotKit
        credentials="include"
        runtimeUrl={backendUrl + '/copilot/chat'}
        useSingleEndpoint={true}
        showDevConsole={false}
      >
        <MantineWrapper>
          <ToolTip />
          <Toaster />
          <TrialTracker />
          <CheckPayment check={searchParams.get('check') || ''} mutate={mutate}>
            <ShowMediaBoxModal />
            <ShowLinkedinCompany />
            <MediaSettingsLayout />
            <ShowPostSelector />
            <PreConditionComponent />
            <NewSubscription />
            <ContinueProvider />
            <div
              className={clsx(
                'flex flex-col min-h-screen min-w-screen text-newTextColor p-[10px] md:p-[8px]',
                !firstBilling && 'pb-[calc(80px+env(safe-area-inset-bottom))] md:pb-[8px]',
              )}
            >
              <div>{user?.admin ? <Impersonate /> : <div />}</div>
              {firstBilling ? (
                <FirstBillingComponent />
              ) : (
                <>
                  <AnnouncementBanner />
                  <div className="flex-1 flex gap-[8px] min-h-0">
                    <Support />
                    {/* okchat-style shell: the sidebar sits on the canvas, the page is one white card */}
                    <aside className="hidden md:flex w-[208px] lg:w-[224px] shrink-0 flex-col">
                      <div
                        id="left-menu"
                        className="sticky top-[8px] flex flex-col h-[calc(100vh-16px)] gap-[14px] pt-[2px] pb-[6px]"
                      >
                        <Brand />
                        <nav aria-label={t('layout_main_nav', '主导航')} className="flex flex-col flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
                          <TopMenu variant="row" />
                        </nav>
                        <SetupChecklist variant="rail" />
                      </div>
                    </aside>
                    <div className="flex-1 min-w-0 flex flex-col">
                      <div className="flex h-[52px] md:h-[48px] px-[4px] md:ps-[6px] md:pe-[4px] gap-[12px] items-center">
                        <div className="text-[18px] md:text-[17px] font-[700] flex flex-1 min-w-0 text-textColor">
                          <Title />
                        </div>
                        {/* phones keep the organisation and notifications; theme and language move to 「更多」 */}
                        <div className="flex items-center md:items-stretch gap-[12px] md:gap-[16px] text-textItemBlur">
                          <QuickCreate />
                          <div className="hidden md:contents">
                            <StreakComponent />
                            <div className="w-[1px] h-[20px] self-center bg-newBorder" />
                          </div>
                          <OrganizationSelector />
                          <div className="hidden md:contents">
                            <div className="hover:text-newTextColor flex items-center">
                              <ModeComponent />
                            </div>
                            <LanguageComponent />
                            <ChromeExtensionComponent />
                            <AttachToFeedbackIcon />
                          </div>
                          <NotificationComponent />
                        </div>
                      </div>
                      <SetupChecklist variant="strip" />
                      {/* phones stack a page's panes (e.g. channels over the calendar) instead of squeezing them side by side */}
                      <main className="flex-1 min-w-0 bg-newBgColorInner rounded-[14px] overflow-clip flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-newBorder blurMe shadow-[0_1px_2px_rgba(10,15,30,0.05)] ring-1 ring-newBorder">
                        {children}
                      </main>
                    </div>
                  </div>
                  <MobileNav />
                </>
              )}
            </div>
          </CheckPayment>
        </MantineWrapper>
      </CopilotKit>
    </ContextWrapper>
  );
};
