import { useCallback, useEffect, useState } from 'react';
import type { GeneratorOptions, Strength } from '../../core/types';
import { api } from '../api';
import { RefreshCw } from 'lucide-react';
import { Ico } from '../components/icons';
import { Button, ColoredPassword, IconButton, StrengthMeter } from '../components/ui';
import { useApp } from '../state';

export function GeneratorPanel({ onUse, useLabel = 'Use' }: { onUse?: (pw: string) => void; useLabel?: string }) {
  const { settings, updateSettings, run } = useApp();
  const [opts, setOpts] = useState<GeneratorOptions | null>(settings?.generator ?? null);
  const [result, setResult] = useState<{ password: string; strength: Strength } | null>(null);

  const regenerate = useCallback(async (o: GeneratorOptions) => setResult(await api.generate(o)), []);
  useEffect(() => { if (opts) void regenerate(opts); }, [opts, regenerate]);
  useEffect(() => { if (!opts && settings) setOpts(settings.generator); }, [settings, opts]);
  if (!opts) return null;

  const set = (patch: Partial<GeneratorOptions>) => {
    const next = { ...opts, ...patch };
    setOpts(next);
    void updateSettings({ generator: next });
  };

  return (
    <div className="generator">
      <div className="gen-output">
        <div className="gen-password">{result && <ColoredPassword value={result.password} />}</div>
        <IconButton title="Generate another" onClick={() => regenerate(opts)}><Ico icon={RefreshCw} /></IconButton>
      </div>
      <StrengthMeter strength={result?.strength ?? null} />
      <div className="seg">
        {(['characters', 'words', 'pin'] as const).map(m => (
          <button key={m} className={opts.mode === m ? 'on' : ''} onClick={() => set({ mode: m })}>
            {m === 'characters' ? 'Random' : m === 'words' ? 'Memorable' : 'PIN'}
          </button>
        ))}
      </div>
      {opts.mode === 'characters' && (<>
        <label className="slider-row">Length <input type="range" min={8} max={64} value={opts.length} onChange={e => set({ length: +e.target.value })} /> <b>{opts.length}</b></label>
        <label className="check"><input type="checkbox" checked={opts.digits} onChange={e => set({ digits: e.target.checked })} /> Numbers</label>
        <label className="check"><input type="checkbox" checked={opts.symbols} onChange={e => set({ symbols: e.target.checked })} /> Symbols</label>
        <label className="check"><input type="checkbox" checked={opts.avoidAmbiguous} onChange={e => set({ avoidAmbiguous: e.target.checked })} /> Avoid look-alike characters (l, 1, O, 0)</label>
      </>)}
      {opts.mode === 'words' && (<>
        <label className="slider-row">Words <input type="range" min={3} max={10} value={opts.wordCount} onChange={e => set({ wordCount: +e.target.value })} /> <b>{opts.wordCount}</b></label>
        <label className="slider-row">Separator
          <select value={opts.separator} onChange={e => set({ separator: e.target.value as GeneratorOptions['separator'] })}>
            <option value="hyphens">Hyphens</option><option value="spaces">Spaces</option><option value="periods">Periods</option>
            <option value="commas">Commas</option><option value="underscores">Underscores</option><option value="digits">Numbers</option>
            <option value="digitsAndSymbols">Numbers and symbols</option>
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={opts.capitalize} onChange={e => set({ capitalize: e.target.checked })} /> Capitalize</label>
        <label className="check"><input type="checkbox" checked={opts.fullWords} onChange={e => set({ fullWords: e.target.checked })} /> Full words (off = pronounceable syllables)</label>
      </>)}
      {opts.mode === 'pin' && (
        <label className="slider-row">Digits <input type="range" min={4} max={12} value={opts.pinLength} onChange={e => set({ pinLength: +e.target.value })} /> <b>{opts.pinLength}</b></label>
      )}
      <div className="row gap">
        <Button onClick={() => result && run(api.copy(result.password, true), 'Password copied')}>Copy</Button>
        {onUse && <Button kind="primary" onClick={() => result && onUse(result.password)}>{useLabel}</Button>}
      </div>
    </div>
  );
}

export function GeneratorView() {
  const { navigate } = useApp();
  return (
    <section className="page">
      <h1>Password Generator</h1>
      <p className="muted">Strong, random passwords made on this device. Copied passwords are cleared from the clipboard automatically.</p>
      <div className="card padded" style={{ maxWidth: 560 }}>
        <GeneratorPanel onUse={pw => { sessionStorage.setItem('prefillPassword', pw); navigate('/new/login'); }} useLabel="Save as new login" />
      </div>
    </section>
  );
}
