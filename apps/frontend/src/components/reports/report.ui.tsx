'use client';

import React, { FC, ReactNode, useCallback, useMemo } from 'react';
import clsx from 'clsx';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

// The small pieces every 报告 tab is built from: cards, soft pill tabs, change marks, account cells.

/** White card on a hairline border. */
export const Card: FC<{ title?: ReactNode; actions?: ReactNode; className?: string; children: ReactNode; labelledBy?: string }> = ({
  title,
  actions,
  className,
  children,
  labelledBy,
}) => (
  <section
    aria-labelledby={labelledBy}
    className={clsx('rounded-[10px] border border-newBorder bg-newBgColorInner p-[16px] md:p-[20px] flex flex-col gap-[14px] min-w-0', className)}
  >
    {(title || actions) && (
      <header className="flex items-center gap-[10px] flex-wrap">
        {title && (
          <h3 id={labelledBy} className="text-[15px] font-[600]">
            {title}
          </h3>
        )}
        {actions && <div className="ms-auto flex items-center gap-[8px] flex-wrap">{actions}</div>}
      </header>
    )}
    {children}
  </section>
);

export const pillClass = (selected: boolean, size: 'md' | 'sm' = 'md') =>
  clsx(
    'rounded-full shrink-0 whitespace-nowrap transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-btnPrimary',
    size === 'md' ? 'px-[14px] h-[34px] text-[14px]' : 'px-[12px] h-[30px] text-[13px]',
    selected ? 'bg-btnSimple text-textColor font-[600] ring-1 ring-newBorder' : 'text-textItemBlur hover:text-textColor hover:bg-boxHover'
  );

/**
 * Soft pill switches (report tabs, periods, granularity): a group of buttons, the pressed one a quiet
 * pill, so the brand color stays on the main action.
 */
export const PillTabs = <T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
}: {
  value: T;
  options: ReadonlyArray<{ key: T; label: string }>;
  onChange: (key: T) => void;
  label: string;
  size?: 'md' | 'sm';
}) => (
  <div role="group" aria-label={label} className="flex gap-[4px] max-w-full overflow-x-auto">
    {options.map((o) => (
      <button key={o.key} type="button" aria-pressed={value === o.key} onClick={() => onChange(o.key)} className={pillClass(value === o.key, size)}>
        {o.label}
      </button>
    ))}
  </div>
);

/** A wide table that scrolls sideways on small screens (and with the keyboard). */
export const ScrollRegion: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <div role="region" aria-label={label} tabIndex={0} className="overflow-x-auto -mx-[16px] md:mx-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-btnPrimary">
    {children}
  </div>
);

/** ▲ 12.3% / ▼ 4% / ■ 0% against the previous period; nothing when there is no base. */
export const Change: FC<{ value: number | null; unit?: string; className?: string }> = ({ value, unit = '%', className }) =>
  value === null ? null : (
    <span
      className={clsx(
        'inline-flex items-center gap-[2px] tabular-nums',
        value > 0 ? 'text-green-500' : value < 0 ? 'text-red-500' : 'text-textItemBlur',
        className
      )}
    >
      <span aria-hidden="true" className="text-[10px]">
        {value > 0 ? '▲' : value < 0 ? '▼' : '■'}
      </span>
      <span className="sr-only">{value > 0 ? '上升' : value < 0 ? '下降' : '持平'}</span>
      {Math.abs(value)}
      {unit}
    </span>
  );

/** An account: platform icon and name. */
export const ChannelCell: FC<{ name: string; providerIdentifier: string; picture?: string | null; note?: ReactNode }> = ({
  name,
  providerIdentifier,
  picture,
  note,
}) => (
  <span className="flex items-center gap-[8px] min-w-0">
    <span className="relative shrink-0 w-[22px] h-[22px]">
      {picture ? (
        <img src={picture} alt="" className="w-[22px] h-[22px] rounded-full object-cover bg-newTableHeader" />
      ) : (
        <span className="block w-[22px] h-[22px] rounded-full bg-newTableHeader" />
      )}
      <img
        src={`/icons/platforms/${providerIdentifier}.png`}
        alt=""
        className="absolute -bottom-[3px] -end-[3px] w-[12px] h-[12px] rounded-full ring-2 ring-newBgColorInner"
      />
    </span>
    <span className="truncate">{name}</span>
    {note}
  </span>
);

/** A quiet empty state inside a card. */
export const Empty: FC<{ children: ReactNode; action?: ReactNode }> = ({ children, action }) => (
  <div className="py-[28px] flex flex-col items-center gap-[12px] text-center text-[14px] text-textItemBlur leading-[1.6]">
    <p className="max-w-[460px]">{children}</p>
    {action}
  </div>
);

/** Provider identifier -> its name (小红书, 抖音…), from the list of providers this instance offers. */
export const usePlatformNames = () => {
  const fetch = useFetch();
  const load = useCallback(async () => (await fetch('/integrations')).json(), []);
  const { data } = useSWR<{ social: Array<{ identifier: string; name: string }> }>('/integrations', load, {
    revalidateOnFocus: false,
  });
  return useMemo(() => {
    const names = new Map((data?.social || []).map((p) => [p.identifier, p.name]));
    return (identifier: string) => names.get(identifier) || identifier;
  }, [data]);
};

export const selectClass =
  'bg-newBgColorInner border border-newBorder rounded-full h-[34px] px-[12px] text-[13px] text-textColor outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary max-w-full';
