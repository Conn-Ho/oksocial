'use client';

import React, { FC, useId } from 'react';

// The wordmark's face: okchat sets its name in IBM Plex Mono 700; without the font it falls back to the
// system monospace, as okchat's own logo does.
export const WORDMARK_FONT = "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

/**
 * The oksocial mark: an "o" ring (you) and one account on an orbit that brightens towards it (your
 * reach), on okchat's brand-blue tile (rx 118 of 512). Only okchat's visual language is shared, not
 * its mark. Kept in sync with public/favicon.svg and public/logo.svg.
 */
export const OkMark: FC<{ size?: number; className?: string; title?: string }> = ({ size = 28, className, title }) => {
  const id = `okmark-${useId().replace(/:/g, '')}`;
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
        <clipPath id={`${id}-c`}>
          <rect width="512" height="512" rx="118" />
        </clipPath>
        <linearGradient id={`${id}-g`} gradientUnits="userSpaceOnUse" x1="140.5" y1="406.5" x2="380.5" y2="149.2">
          <stop offset="0" stopColor="#fff" stopOpacity="0.1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.85" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${id}-c)`}>
        <rect width="512" height="512" fill="#0A6CFB" />
        <path d="M 140.5 406.5 A 176 176 0 0 1 380.5 149.2" fill="none" stroke={`url(#${id}-g)`} strokeWidth="32" strokeLinecap="round" />
        <circle cx="265" cy="282" r="86" fill="none" stroke="#fff" strokeWidth="58" />
        {/* a ring of the tile's blue keeps the account clear of the orbit's bright end */}
        <circle cx="389.5" cy="157.5" r="58" fill="#0A6CFB" />
        <circle cx="389.5" cy="157.5" r="46" fill="#fff" />
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
