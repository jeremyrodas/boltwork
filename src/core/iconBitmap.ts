/**
 * Draws the Strongroom mark (rounded square with a vault-door dial) as straight-alpha RGBA,
 * so neither the app nor the extension needs binary image assets. `locked` greys it for the tray.
 */
export function drawIcon(size: number, locked = false): Uint8Array {
  const buf = new Uint8Array(size * size * 4);
  const r = size * 0.22; // corner radius
  const c = size / 2;
  const top = locked ? [120, 120, 130] : [37, 99, 235];
  const bottom = locked ? [80, 80, 90] : [109, 40, 217];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5, py = y + 0.5;
      const dx = Math.max(r - px, 0, px - (size - r));
      const dy = Math.max(r - py, 0, py - (size - r));
      const d = Math.hypot(dx, dy) - r;
      const inside = Math.min(1, Math.max(0, 0.5 - d));
      if (inside <= 0) continue;
      const t = py / size;
      let rgb = top.map((v, i) => Math.round(v + (bottom[i] - v) * t));
      const dist = Math.hypot(px - c, py - c);
      const ring = Math.abs(dist - size * 0.28) < size * 0.055;
      const hub = dist < size * 0.09;
      const ang = Math.atan2(py - c, px - c);
      const spoke = dist < size * 0.28 && [0, 2.094, -2.094].some(a => Math.abs(Math.sin(ang - a)) * dist < size * 0.035 && Math.cos(ang - a) > 0);
      if (ring || hub || spoke) rgb = [255, 255, 255];
      const i = (y * size + x) * 4;
      buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2]; buf[i + 3] = Math.round(255 * inside);
    }
  }
  return buf;
}
