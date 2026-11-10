import { useEffect, useRef, useState } from 'react';
import { CircleCheck, ScanQrCode } from 'lucide-react';
import { parseSetupCode, type SetupCode } from '../../core/setupCode';
import { api } from '../api';
import { decodeQrFromFile, decodeQrFromVideo, pickFile } from '../qr';
import { useApp } from '../state';
import { Ico } from './icons';
import { Button, Menu, Modal } from './ui';

/** Reads a scanned QR code as a setup code, or says why it isn't one. */
function readCode(text: string): SetupCode | string {
  try { return parseSetupCode(text); } catch (e) { return (e as Error).message; }
}

/**
 * The Secret Key on sign-in screens. "Scan code" reads a setup code (from the Emergency Kit, Show Secret Key or
 * Settings → Sync on a signed-in device). Once scanned, the key stays hidden: the field shows only that it came
 * from the code, and "Type it instead" goes back to typing.
 */
export function SecretKeyInput({ id, value, onChange, scanned, onScanned, onUnscan, onEnter, autoFocus }: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  /** True once a setup code has supplied the key. */
  scanned: boolean;
  onScanned: (c: SetupCode) => void;
  onUnscan: () => void;
  onEnter?: () => void;
  autoFocus?: boolean;
}) {
  if (scanned) {
    return (
      <div className="sk-scanned" id={id} role="status">
        <Ico icon={CircleCheck} />
        <span className="grow">Secret Key from your setup code</span>
        <Button small kind="ghost" onClick={onUnscan}>Type it instead</Button>
      </div>
    );
  }
  return (
    <div className="sk-input">
      <input id={id} className="mono" value={value} onChange={e => onChange(e.target.value)} placeholder="SR1-XXXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
        spellCheck={false} autoComplete="off" autoFocus={autoFocus} onKeyDown={e => { if (e.key === 'Enter') onEnter?.(); }} />
      <ScanCodeButton onScanned={onScanned} />
    </div>
  );
}

/** "Scan code": with the camera, from the screen or from an image file. */
export function ScanCodeButton({ onScanned }: { onScanned: (c: SetupCode) => void }) {
  const { run, toast } = useApp();
  const [camera, setCamera] = useState(false);
  const found = (text: string | null, none: string) => {
    if (text === null) { toast(none, 'error'); return; }
    const c = readCode(text);
    if (typeof c === 'string') { toast(c, 'error'); return; }
    onScanned(c);
  };
  return (<>
    <Menu trigger={<Button type="button" title="Read your Secret Key from a setup code instead of typing it"><Ico icon={ScanQrCode} /> Scan code</Button>} items={[
      { label: 'With the camera…', onClick: () => setCamera(true) },
      { label: 'On the screen', onClick: async () => {
        const r = await run(api.scanQrFromScreen());
        if (r !== undefined) found(r, 'No QR code found on the screen. Open your Emergency Kit or the setup code so it’s visible, then try again.');
      } },
      { label: 'From an image file…', onClick: async () => {
        const f = await pickFile('image/*');
        if (f) found(await decodeQrFromFile(f).catch(() => null), 'No QR code found in that image.');
      } },
    ]} />
    {camera && <CameraScanner onClose={() => setCamera(false)} onFound={c => { setCamera(false); onScanned(c); }} />}
  </>);
}

/** Webcam view that reads setup codes. Keeps looking until it finds one or is closed. */
function CameraScanner({ onFound, onClose }: { onFound: (c: SetupCode) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'starting' | 'scanning' | 'error'>('starting');
  const [message, setMessage] = useState('');
  const done = useRef(onFound);
  done.current = onFound;
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const tick = () => {
      if (stopped || !video.current) return;
      const text = decodeQrFromVideo(video.current, canvas);
      if (text) {
        const c = readCode(text);
        if (typeof c !== 'string') { stopped = true; done.current(c); return; }
        setMessage(c);
      }
      timer = window.setTimeout(tick, 120);
    };
    navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then(async s => {
        if (stopped) { s.getTracks().forEach(t => t.stop()); return; }
        stream = s;
        const v = video.current!;
        v.srcObject = s;
        await v.play();
        setState('scanning');
        tick();
      })
      .catch((e: Error) => {
        setState('error');
        setMessage(e.name === 'NotFoundError' ? 'No camera was found on this computer. Try “On the screen” or “From an image file” instead.'
          : e.name === 'NotAllowedError' ? 'Boltwork isn’t allowed to use the camera. In Windows Settings, open Privacy & security → Camera and allow desktop apps.'
          : `The camera didn’t start: ${e.message}`);
      });
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach(t => t.stop());
    };
  }, []);
  return (
    <Modal title="Scan setup code" onClose={onClose}>
      <p className="muted">Hold the setup code up to the camera: the QR code in your Emergency Kit, or the one a signed-in device shows.</p>
      <div className={`qr-camera ${state}`} hidden={state === 'error'}>
        <video ref={video} muted playsInline aria-label="Camera view" />
        {state === 'scanning' && <div className="qr-frame" aria-hidden="true" />}
        {state === 'starting' && <span className="qr-camera-note">Starting the camera…</span>}
      </div>
      {message && <p className={state === 'error' ? 'error-text' : 'hint'} role="status">{message}</p>}
      <div className="row gap end"><Button onClick={onClose}>Cancel</Button></div>
    </Modal>
  );
}
