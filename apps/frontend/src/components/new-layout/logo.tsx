'use client';

// oksocial mark: the "ok" monogram on the primary tile.
export const Logo = () => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="60"
      height="60"
      viewBox="0 0 60 60"
      fill="none"
      className="mt-[8px] min-w-[60px] min-h-[60px]"
    >
      <rect x="6" y="6" width="48" height="48" rx="14" fill="#612BD3" />
      <circle cx="23" cy="31" r="7.5" stroke="white" strokeWidth="5" />
      <path
        d="M36 19V43M36 34L45 25M39.5 31L46 42"
        stroke="white"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

/** The sidebar brand: the mark and the wordmark. */
export const Brand = () => (
  <div className="flex items-center gap-[10px] h-[40px] px-[8px]">
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="6 6 48 48" fill="none" aria-hidden="true">
      <rect x="6" y="6" width="48" height="48" rx="14" fill="#612BD3" />
      <circle cx="23" cy="31" r="7.5" stroke="white" strokeWidth="5" />
      <path d="M36 19V43M36 34L45 25M39.5 31L46 42" stroke="white" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    <span className="text-[17px] font-[800] tracking-[-0.01em] text-textColor">oksocial</span>
  </div>
);
