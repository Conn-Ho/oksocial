import { FC } from 'react';
import clsx from 'clsx';

type CreationMethod =
  | 'UNKNOWN'
  | 'WEB'
  | 'API'
  | 'MCP'
  | 'AUTOPOST'
  | 'CLI'
  | 'AUTOMATION'
  | 'BULK_IMPORT'
  | 'AI';

interface Props {
  creationMethod?: CreationMethod | string | null;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  ringColor?: string;
}

const tooltipFor = (m: string) =>
  m === 'AUTOPOST'
    ? 'Auto-posted by system'
    : m === 'AUTOMATION'
    ? '由自动化生成'
    : m === 'BULK_IMPORT'
    ? '由 Excel 批量导入'
    : m === 'AI'
    ? '由 AI 创作'
    : `Created via ${m}`;

export const CreationMethodBadge: FC<Props> = ({
  creationMethod,
  size = 'xs',
  className,
  ringColor,
}) => {
  if (!creationMethod || creationMethod === 'UNKNOWN') return null;

  const sizeClasses =
    size === 'xs'
      ? 'h-[12px] px-[4px] text-[7px]'
      : size === 'md'
      ? 'h-[22px] px-[10px] text-[12px]'
      : 'h-[18px] px-[8px] text-[10px]';

  return (
    <div
      className={clsx(
        'inline-flex items-center justify-center rounded-full text-white font-bold uppercase tracking-wide leading-none cursor-default',
        sizeClasses,
        creationMethod === 'WEB' && 'bg-[#6b7280]',
        creationMethod === 'API' && 'bg-[#2563eb]',
        creationMethod === 'MCP' && 'bg-[#9333ea]',
        creationMethod === 'AUTOPOST' && 'bg-[#d97706]',
        creationMethod === 'CLI' && 'bg-[#0f766e]',
        creationMethod === 'AUTOMATION' && 'bg-[#612BD3]',
        creationMethod === 'BULK_IMPORT' && 'bg-[#0891b2]',
        creationMethod === 'AI' && 'bg-[#db2777]',
        className
      )}
      style={ringColor ? { boxShadow: `0 0 0 2px ${ringColor}` } : undefined}
      data-tooltip-id="tooltip"
      data-tooltip-content={tooltipFor(creationMethod)}
    >
      {creationMethod}
    </div>
  );
};
