/**
 * The Strongroom mark as SVG: a brass vault door on graphite. Same geometry as src/core/iconBitmap.ts
 * (a 72-unit square), so the in-app logo matches the window, tray and extension icons.
 * With `turning`, the handwheel spins a third of a turn: the lock screen uses it while the vault opens.
 */
const SPOKES = [-90, 30, 150];
const BOLTS = Array.from({ length: 8 }, (_, k) => (k * 45 + 22.5) * (Math.PI / 180));

export function BrandMark({ size = 26, turning = false, className = '' }: { size?: number; turning?: boolean; className?: string }) {
  const small = size <= 24;
  return (
    <svg className={`brand-mark ${className}`} width={size} height={size} viewBox="0 0 72 72" aria-hidden="true" focusable="false">
      <rect x="2.75" y="2.75" width="66.5" height="66.5" rx="15.25" fill="#1f2430" stroke="#485062" strokeWidth="1.5" />
      {small ? (
        <circle cx="36" cy="36" r="23.25" fill="none" stroke="#c9a45c" strokeWidth="9.5" />
      ) : (<>
        <circle cx="36" cy="36" r="23.75" fill="none" stroke="#c9a45c" strokeWidth="6.5" />
        {BOLTS.map((a, i) => <circle key={i} cx={36 + Math.cos(a) * 23.75} cy={36 + Math.sin(a) * 23.75} r="1.7" fill="#1f2430" />)}
      </>)}
      <g className={`brand-wheel${turning ? ' turning' : ''}`}>
        {SPOKES.map(d => {
          const a = (d * Math.PI) / 180;
          const len = small ? 12 : 13.5;
          const ex = 36 + Math.cos(a) * len, ey = 36 + Math.sin(a) * len;
          return (
            <g key={d}>
              <line x1="36" y1="36" x2={ex} y2={ey} stroke="#c9a45c" strokeWidth={small ? 7 : 3.8} strokeLinecap="round" />
              {!small && <circle cx={ex} cy={ey} r="2.9" fill="#c9a45c" />}
            </g>
          );
        })}
        <circle cx="36" cy="36" r={small ? 6.5 : 5} fill="#c9a45c" />
        {!small && <circle cx="36" cy="36" r="1.8" fill="#1f2430" />}
      </g>
    </svg>
  );
}
