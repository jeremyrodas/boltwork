import jsQR from 'jsqr';

/** Reads the first QR code in an image file. */
export async function decodeQrFromFile(file: File): Promise<string | null> {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  // Phone photos are 12 megapixels or more: slow to search at full size, and the code's fine detail can confuse the
  // reader. Try the image at its own size (when that's reasonable) and at a few smaller sizes.
  const longest = Math.max(bmp.width, bmp.height);
  const sizes = [...new Set([Math.min(longest, 2000), 1400, 1000, 700].filter(s => s <= longest))];
  try {
    for (const size of sizes) {
      const scale = size / longest;
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const text = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data;
      if (text) return text;
    }
    return null;
  } finally {
    bmp.close();
  }
}

/** Reads a QR code from the current video frame, scaled down so each frame stays quick. */
export function decodeQrFromVideo(video: HTMLVideoElement, canvas: HTMLCanvasElement): string | null {
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) return null;
  const scale = Math.min(1, 960 / Math.max(w, h));
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
}

/** Asks for a file. With `capture`, phones open the camera to take a photo instead (computers show the file picker). */
export function pickFile(accept: string, capture?: 'environment' | 'user'): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    if (capture) input.setAttribute('capture', capture);
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
