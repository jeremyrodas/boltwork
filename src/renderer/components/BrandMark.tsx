/**
 * The Boltwork mark as SVG: a vault door. Same geometry as src/core/iconBitmap.ts (a 72-unit square),
 * so the in-app logo matches the window, tray and extension icons. Its colors come from the current color
 * scheme (--mark-* variables, set with the theme), or from `scheme` when previewing one.
 * With `turning`, the handwheel spins a third of a turn: the lock screen uses it while the vault opens.
 */
import type { CSSProperties } from 'react';
import { SCHEMES, type ColorScheme } from '../../core/schemes';

const SPOKES = [-90, 30, 150];
const BOLTS = Array.from({ length: 8 }, (_, k) => (k * 45 + 22.5) * (Math.PI / 180));

const BODY = { fill: 'var(--mark-body, #1f2430)' };
const METAL_FILL = { fill: 'var(--mark-metal, #c9a45c)' };
const METAL_STROKE = { stroke: 'var(--mark-metal, #c9a45c)' };

export function BrandMark({ size = 26, turning = false, className = '', scheme }: { size?: number; turning?: boolean; className?: string; scheme?: ColorScheme }) {
  const small = size <= 24;
  const vars = scheme
    ? ({ '--mark-body': SCHEMES[scheme].mark.body, '--mark-edge': SCHEMES[scheme].mark.edge, '--mark-metal': SCHEMES[scheme].mark.metal } as CSSProperties)
    : undefined;
  return (
    <svg className={`brand-mark ${className}`} width={size} height={size} viewBox="0 0 72 72" aria-hidden="true" focusable="false" style={vars}>
      <rect x="2.75" y="2.75" width="66.5" height="66.5" rx="15.25" strokeWidth="1.5" style={{ ...BODY, stroke: 'var(--mark-edge, #485062)' }} />
      {small ? (
        <circle cx="36" cy="36" r="23.25" fill="none" strokeWidth="9.5" style={METAL_STROKE} />
      ) : (<>
        <circle cx="36" cy="36" r="23.75" fill="none" strokeWidth="6.5" style={METAL_STROKE} />
        {BOLTS.map((a, i) => <circle key={i} cx={36 + Math.cos(a) * 23.75} cy={36 + Math.sin(a) * 23.75} r="1.7" style={BODY} />)}
      </>)}
      <g className={`brand-wheel${turning ? ' turning' : ''}`}>
        {SPOKES.map(d => {
          const a = (d * Math.PI) / 180;
          const len = small ? 12 : 13.5;
          const ex = 36 + Math.cos(a) * len, ey = 36 + Math.sin(a) * len;
          return (
            <g key={d}>
              <line x1="36" y1="36" x2={ex} y2={ey} strokeWidth={small ? 7 : 3.8} strokeLinecap="round" style={METAL_STROKE} />
              {!small && <circle cx={ex} cy={ey} r="2.9" style={METAL_FILL} />}
            </g>
          );
        })}
        <circle cx="36" cy="36" r={small ? 6.5 : 5} style={METAL_FILL} />
        {!small && <circle cx="36" cy="36" r="1.8" style={BODY} />}
      </g>
    </svg>
  );
}
