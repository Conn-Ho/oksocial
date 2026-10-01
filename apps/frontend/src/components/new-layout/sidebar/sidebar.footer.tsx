'use client';

import React, { FC } from 'react';
import { SetupChecklist } from '@gitroom/frontend/components/onboarding/setup.checklist';
import { SidebarPlanCard } from '@gitroom/frontend/components/new-layout/sidebar/plan.card';
import { AccountMenu } from '@gitroom/frontend/components/new-layout/sidebar/account.menu';

/**
 * The foot of the desktop sidebar, on every page and pinned under the scrolling menu (okchat's
 * layout): the setup guide (one row until opened), the plan card when billing is on, and the
 * account card with the team and personal menu.
 */
export const SidebarFooter: FC = () => (
  <div className="shrink-0 flex flex-col gap-[8px] pt-[10px] border-t border-newBorder blurMe">
    <SetupChecklist variant="rail" />
    <SidebarPlanCard />
    <AccountMenu />
  </div>
);
