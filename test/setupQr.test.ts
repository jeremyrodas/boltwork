import { test } from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { parseSetupCode, setupCodeText } from '../src/core/setupCode';

// The desktop app draws setup codes with qrcode and reads them with jsQR: check the two agree.
test('a setup code QR image reads back as the same setup code', () => {
  const code = { server: 'https://sync.example.com', backup: 'http://100.64.0.5:8787', email: 'sam@example.com', secretKey: 'SR1-ABCDEF-GHJKM-NPQRS-TVWXY-Z0123' };
  const text = setupCodeText(code);
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size, scale = 6, margin = 4, size = (n + margin * 2) * scale;
  const rgba = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!qr.modules.get(x, y)) continue;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const i = (((y + margin) * scale + dy) * size + (x + margin) * scale + dx) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
    }
  }
  const read = jsQR(rgba, size, size)?.data;
  assert.equal(read, text);
  assert.deepEqual(parseSetupCode(read!), code);
});
