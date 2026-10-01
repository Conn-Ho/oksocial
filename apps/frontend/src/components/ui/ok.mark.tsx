'use client';

import React, { FC, useId } from 'react';

// The wordmark's face: okchat sets its name in IBM Plex Mono 700; without the font it falls back to the
// system monospace, as okchat's own logo does.
export const WORDMARK_FONT = "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

/**
 * The oksocial mark, okchat's sibling: the same brand-blue tile (rx 118 of 512) and tilted ledger bars
 * with fading opacity, each row led by an avatar dot, so the bars read as a feed of posts.
 * Kept in sync with public/favicon.svg and public/logo.svg.
 */
export const OkMark: FC<{ size?: number; className?: string; title?: string }> = ({ size = 28, className, title }) => {
  const clip = `okmark-${useId().replace(/:/g, '')}`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <clipPath id={clip}>
          <rect width="512" height="512" rx="118" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect width="512" height="512" fill="#0A6CFB" />
        <g transform="rotate(-24 256 256)" fill="#fff">
          <circle cx="104" cy="162" r="38" />
          <rect x="164" y="136" width="268" height="52" rx="26" />
          <circle cx="104" cy="256" r="38" opacity=".66" />
          <rect x="164" y="230" width="190" height="52" rx="26" opacity=".66" />
          <circle cx="104" cy="350" r="38" opacity=".36" />
          <rect x="164" y="324" width="268" height="52" rx="26" opacity=".36" />
        </g>
      </g>
    </svg>
  );
};

/** The mark with the wordmark, for headers and the sign-in panel. */
export const OkLogo: FC<{ size?: number; className?: string }> = ({ size = 28, className }) => (
  <span className={`inline-flex items-center gap-[10px] ${className ?? ''}`}>
    <OkMark size={size} />
    <span
      className="font-[700] text-textColor"
      style={{ fontFamily: WORDMARK_FONT, fontSize: Math.round(size * 0.62), letterSpacing: '-0.02em' }}
    >
      oksocial
    </span>
  </span>
);
