import { nativeImage, type NativeImage } from 'electron';
import { drawIcon } from '../core/iconBitmap';
import type { ColorScheme } from '../core/schemes';

/** The Strongroom mark as an Electron image (BGRA, premultiplied). */
export function makeIcon(size: number, locked = false, scheme: ColorScheme = 'brass'): NativeImage {
  const rgba = drawIcon(size, locked, scheme);
  const buf = Buffer.alloc(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] / 255;
    buf[i] = Math.round(rgba[i + 2] * a);
    buf[i + 1] = Math.round(rgba[i + 1] * a);
    buf[i + 2] = Math.round(rgba[i] * a);
    buf[i + 3] = rgba[i + 3];
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}
