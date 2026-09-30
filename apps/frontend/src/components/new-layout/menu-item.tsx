'use client';
import { FC, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import Link from 'next/link';

export const MenuItem: FC<{
  label: string;
  icon: ReactNode;
  path: string;
  onClick?: () => void;
  /** Overrides the "path is the current page" check, e.g. for the phone 「更多」 button. */
  active?: boolean;
  /** For a button that opens a dialog: whether that dialog is open. */
  expanded?: boolean;
  /** row: icon and label side by side (the desktop sidebar); rail: stacked (the phone bar). */
  variant?: 'rail' | 'row';
}> = ({ label, icon, path, onClick, active, expanded, variant = 'rail' }) => {
  const currentPath = usePathname();
  const isActive = active ?? currentPath.indexOf(path) === 0;

  const className =
    variant === 'row'
      ? clsx(
          // the sidebar sits on the canvas: the current page is a white block on it
          'group w-full h-[38px] px-[10px] gap-[10px] flex items-center rounded-[10px] text-[14px] transition-colors duration-150',
          isActive
            ? 'bg-newBgColorInner text-textColor font-[600] shadow-[0_1px_2px_rgba(10,15,30,0.06)] ring-1 ring-newBorder'
            : 'text-textItemBlur font-[500] hover:bg-boxHover hover:text-textColor'
        )
      : clsx(
          'group w-full minCustom:h-[54px] custom:h-[44px] py-[8px] px-[6px] minCustom:gap-[4px] custom:gap-[2px] flex flex-col font-[600] items-center justify-center rounded-[12px] hover:text-textItemFocused hover:bg-boxFocused transition-colors',
          isActive ? 'text-textItemFocused bg-boxFocused' : 'text-textItemBlur'
        );

  const inner =
    variant === 'row' ? (
      <>
        <span
          className={clsx(
            'w-[20px] h-[20px] shrink-0 flex items-center justify-center [&_svg]:w-[18px] [&_svg]:h-[18px]',
            isActive ? 'text-btnPrimary' : 'text-textItemBlur group-hover:text-textColor'
          )}
          aria-hidden="true"
        >
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </>
    ) : (
      <>
        <div className="custom:scale-90 transition-transform">{icon}</div>
        <div className="custom:text-[9px] minCustom:text-[10px] leading-[1.1] text-center">
          {label}
        </div>
      </>
    );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={label}
        aria-haspopup={expanded === undefined ? undefined : 'dialog'}
        aria-expanded={expanded}
        className={className}
      >
        {inner}
      </button>
    );
  }

  return (
    <Link
      prefetch={true}
      href={path}
      title={label}
      aria-current={isActive ? 'page' : undefined}
      {...path.indexOf('http') === 0 && { target: '_blank' }}
      className={className}
    >
      {inner}
    </Link>
  );
};
