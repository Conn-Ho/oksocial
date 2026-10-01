import { FC } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

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

const tooltipFor = (m: string, t: ReturnType<typeof useT>) =>
  m === 'AUTOPOST'
    ? t('creation_method_tip_autopost', '由系统自动发布')
    : m === 'AUTOMATION'
    ? t('creation_method_tip_automation', '由自动化生成')
    : m === 'BULK_IMPORT'
    ? t('creation_method_tip_bulk_import', '由 Excel 批量导入')
    : m === 'AI'
    ? t('creation_method_tip_ai', '由 AI 创作')
    : t('creation_method_tip_other', '通过 {{method}} 创建', {
        method: m,
        interpolation: { escapeValue: false },
      });

// API / MCP / CLI stay as they are; the rest read better in Chinese.
const LABELS: Record<string, string> = {
  WEB: '网页',
  AUTOPOST: '自动发布',
  AUTOMATION: '自动化',
  BULK_IMPORT: 'Excel',
  AI: 'AI',
};

export const CreationMethodBadge: FC<Props> = ({
  creationMethod,
  size = 'xs',
  className,
  ringColor,
}) => {
  const t = useT();
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
        creationMethod === 'MCP' && 'bg-[#4C90FD]',
        creationMethod === 'AUTOPOST' && 'bg-[#d97706]',
        creationMethod === 'CLI' && 'bg-[#0f766e]',
        creationMethod === 'AUTOMATION' && 'bg-btnPrimary',
        creationMethod === 'BULK_IMPORT' && 'bg-[#0891b2]',
        creationMethod === 'AI' && 'bg-[#db2777]',
        className
      )}
      style={ringColor ? { boxShadow: `0 0 0 2px ${ringColor}` } : undefined}
      data-tooltip-id="tooltip"
      data-tooltip-content={tooltipFor(creationMethod, t)}
    >
      {LABELS[creationMethod]
        ? t(
            `creation_method_${creationMethod.toLowerCase()}`,
            LABELS[creationMethod]
          )
        : creationMethod}
    </div>
  );
};
