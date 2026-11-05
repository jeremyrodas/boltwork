/**
 * The Strongroom mark: a vault door in brass on graphite (or another metal, see schemes.ts). A brass rim set with dark bolts, and a
 * three-spoke handwheel on a hub. Drawn here as straight-alpha RGBA at any size, so the app window,
 * tray and browser extension need no image files. At 24px and below the bolts and spoke caps are
 * dropped and the rim and spokes thicken, so the mark stays legible in the tray and toolbar.
 *
 * Geometry is in a 72-unit square, matching BrandMark in the renderer.
 */

import { SCHEMES, type ColorScheme } from './schemes';

type RGB = readonly [number, number, number];
const rgb = (hex: string): RGB => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as unknown as RGB;
interface Layer { color: RGB; coverage: (x: number, y: number) => number }

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function drawIcon(size: number, locked = false, scheme: ColorScheme = 'brass'): Uint8Array {
  const s = size / 72; // pixels per unit
  const small = size <= 24;
  const colors = SCHEMES[scheme].mark;
  const brass = rgb(locked ? colors.locked : colors.metal); // "brass" is the metal of whichever scheme
  const graphite = rgb(colors.body);
  const edgeColor = rgb(colors.edge);
  const c = 36;

  // Coverage helpers (unit space in, pixel-accurate antialiasing out).
  const disc = (cx: number, cy: number, r: number) => (x: number, y: number) => clamp01((r - Math.hypot(x - cx, y - cy)) * s + 0.5);
  const ring = (r0: number, r1: number) => (x: number, y: number) => {
    const d = Math.hypot(x - c, y - c);
    return Math.min(clamp01((r1 - d) * s + 0.5), clamp01((d - r0) * s + 0.5));
  };
  const segment = (x1: number, y1: number, x2: number, y2: number, w: number) => (x: number, y: number) => {
    const dx = x2 - x1, dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
    const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
    return clamp01((w / 2 - d) * s + 0.5);
  };
  const roundedSquare = (inset: number, r: number) => (x: number, y: number) => {
    const lo = inset + r, hi = 72 - inset - r;
    const qx = Math.max(lo - x, 0, x - hi), qy = Math.max(lo - y, 0, y - hi);
    return clamp01((r - Math.hypot(qx, qy)) * s + 0.5);
  };

  const spokeAngles = [-90, 30, 150].map(a => (a * Math.PI) / 180);
  // A thin lighter edge keeps the square visible on dark taskbars and toolbars.
  const edge = Math.max(1.5, 1 / s);
  const layers: Layer[] = [
    { color: edgeColor, coverage: roundedSquare(2, 16) },
    { color: graphite, coverage: roundedSquare(2 + edge, 16 - edge) },
  ];
  if (small) {
    layers.push({ color: brass, coverage: ring(18.5, 28) });
    for (const a of spokeAngles) layers.push({ color: brass, coverage: segment(c, c, c + Math.cos(a) * 12, c + Math.sin(a) * 12, 7) });
    layers.push({ color: brass, coverage: disc(c, c, 6.5) });
  } else {
    layers.push({ color: brass, coverage: ring(20.5, 27) });
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4 + Math.PI / 8;
      layers.push({ color: graphite, coverage: disc(c + Math.cos(a) * 23.75, c + Math.sin(a) * 23.75, 1.7) });
    }
    for (const a of spokeAngles) {
      const ex = c + Math.cos(a) * 13.5, ey = c + Math.sin(a) * 13.5;
      layers.push({ color: brass, coverage: segment(c, c, ex, ey, 3.8) });
      layers.push({ color: brass, coverage: disc(ex, ey, 2.9) });
    }
    layers.push({ color: brass, coverage: disc(c, c, 5) });
    layers.push({ color: graphite, coverage: disc(c, c, 1.8) });
  }

  const buf = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / s, y = (py + 0.5) / s;
      let r = 0, g = 0, b = 0, a = 0;
      for (const l of layers) {
        const cov = l.coverage(x, y);
        if (cov <= 0) continue;
        // "over" compositing in premultiplied space
        r = l.color[0] * cov + r * (1 - cov);
        g = l.color[1] * cov + g * (1 - cov);
        b = l.color[2] * cov + b * (1 - cov);
        a = cov + a * (1 - cov);
      }
      const i = (py * size + px) * 4;
      if (a > 0) { buf[i] = Math.round(r / a); buf[i + 1] = Math.round(g / a); buf[i + 2] = Math.round(b / a); }
      buf[i + 3] = Math.round(a * 255);
    }
  }
  return buf;
}
