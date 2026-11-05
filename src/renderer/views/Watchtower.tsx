import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, CircleCheck, CloudOff } from 'lucide-react';
import type { WatchtowerCheck, WatchtowerReport } from '../../core/types';
import { api, on } from '../api';
import { Ico, WATCHTOWER_ICONS } from '../components/icons';
import { Button, Empty, ItemIcon, timeAgo } from '../components/ui';
import { useApp } from '../state';

const SEVERITY_LABEL = { severe: 'Fix now', attention: 'Important', tip: 'Suggestion' } as const;

export const CHECKS: { check: WatchtowerCheck; title: string; severity: 'severe' | 'attention' | 'tip'; help: string }[] = [
  { check: 'compromisedWebsite', title: 'Compromised Logins', severity: 'severe', help: 'The website reported a breach after you last changed this password.' },
  { check: 'vulnerable', title: 'Vulnerable Passwords', severity: 'severe', help: 'These passwords appeared in known data breaches.' },
  { check: 'reused', title: 'Reused Passwords', severity: 'attention', help: 'One breach could unlock all of these accounts.' },
  { check: 'weak', title: 'Weak Passwords', severity: 'attention', help: 'Easy to guess. Replace them with generated passwords.' },
  { check: 'unsecured', title: 'Unsecured Websites', severity: 'tip', help: 'These addresses use HTTP. Try switching them to HTTPS.' },
  { check: 'inactive2fa', title: 'Inactive Two-Factor Authentication', severity: 'tip', help: 'These sites support one-time codes. Turn it on and save the code here.' },
  { check: 'expiring', title: 'Expiring', severity: 'tip', help: 'Cards, passports, licenses and memberships expiring within 30 days.' },
  { check: 'duplicate', title: 'Duplicate Items', severity: 'tip', help: 'Same website and username saved more than once.' },
];

/** Last report seen, so switching between Home and Watchtower doesn't blank the score. */
let lastReport: WatchtowerReport | null = null;

/**
 * The latest Watchtower report. The app runs one check at a time and broadcasts each result, so this keeps
 * showing the last report while a new check runs, and re-checks a moment after the vault stops changing.
 */
export function useWatchtower() {
  const { data, settings } = useApp();
  const [report, setReport] = useState<WatchtowerReport | null>(lastReport);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; phase: 'strength' | 'breaches' } | null>(null);
  const refresh = useCallback(async () => {
    setBusy(true);
    try { const r = await api.watchtower(); lastReport = r; setReport(r); } catch { /* locked meanwhile */ } finally { setBusy(false); }
  }, []);
  useEffect(() => {
    const offs = [
      on('watchtowerUpdated', r => { lastReport = r; setReport(r); }),
      on('watchtowerProgress', p => setProgress(p)),
    ];
    return () => offs.forEach(off => off());
  }, []);
  // First check at once; after edits or synced changes, wait until things settle.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; void refresh(); return; }
    const t = setTimeout(() => { void refresh(); }, 2000);
    return () => clearTimeout(t);
  }, [data, settings?.checkVulnerable, settings?.checkCompromisedSites, settings?.check2faSites, refresh]);
  return { report, busy: busy || !!progress, progress, refresh };
}

/** What the two online checks find, in a sentence each. */
const ONLINE_WHAT: Partial<Record<WatchtowerCheck, string>> = {
  vulnerable: 'passwords that have shown up in data breaches',
  compromisedWebsite: 'websites that were breached after you last changed the password',
};

function scoreColor(score: number, partial: boolean) {
  if (partial) return 'var(--muted)';
  return score > 800 ? 'var(--good-text)' : score > 600 ? 'var(--strength-4)' : score > 400 ? 'var(--warn-text)' : 'var(--bad-text)';
}

export function WatchtowerView() {
  const { data, settings, navigate, updateSettings } = useApp();
  const { report, busy, progress, refresh } = useWatchtower();
  const [open, setOpen] = useState<WatchtowerCheck | null>(null);
  if (!data || !settings) return null;
  const isOff = (c: WatchtowerCheck) => (c === 'vulnerable' && !settings.checkVulnerable) || (c === 'compromisedWebsite' && !settings.checkCompromisedSites);
  const offChecks = CHECKS.filter(c => isOff(c.check));
  const offCount = offChecks.length;
  const partial = offCount > 0;
  // Checks that ran come first; switched-off ones go to the end.
  const ordered = [...CHECKS.filter(c => !isOff(c.check)), ...offChecks];
  const turnOnAll = () => updateSettings({ checkVulnerable: true, checkCompromisedSites: true, check2faSites: true });
  const turnOn = (c: WatchtowerCheck) => updateSettings(c === 'vulnerable' ? { checkVulnerable: true } : { checkCompromisedSites: true });

  return (
    <section className="page">
      <div className="row between">
        <h1>Watchtower</h1>
        <Button small onClick={refresh} disabled={busy}>{progress ? `Checking ${progress.phase === 'strength' ? 'strength' : 'breaches'} ${progress.done} of ${progress.total}…` : busy ? 'Checking…' : 'Check again'}</Button>
      </div>
      {report && (
        <div className="wt-hero card padded">
          <div className="wt-score" style={{ ['--ring' as string]: scoreColor(report.score, partial) }}>
            <b style={{ color: scoreColor(report.score, partial) }}>{report.score}</b><span>of 1000</span>
          </div>
          <div>
            <h2>{partial ? 'Partial check' : `Password security: ${report.scoreLabel}`}</h2>
            <p className="muted">
              {report.issues.length === 0 ? 'No problems found in the checks that ran.' : `${report.issues.length} thing${report.issues.length > 1 ? 's' : ''} to look at.`} Checked {timeAgo(report.checkedAt)}.
            </p>
            {partial && <p className="muted small">The score leaves out the {offCount === 1 ? 'check that is' : `${offCount} checks that are`} off.</p>}
          </div>
        </div>
      )}
      {partial && (
        <div className="wt-callout card padded" role="region" aria-label="Online checks are off">
          <span className="wt-callout-icon"><Ico icon={CloudOff} size={20} /></span>
          <div className="grow">
            <h3>Turn on online checks to find breached passwords</h3>
            <p>
              {offCount === 1 ? 'One check is off' : `${offCount === 2 ? 'Two' : offCount} checks are off`}, so Watchtower can’t warn you about{' '}
              {[...offChecks].sort((a, b) => (a.check === 'vulnerable' ? -1 : b.check === 'vulnerable' ? 1 : 0)).map((c, i) => <span key={c.check}>{i > 0 && ' or '}<b>{ONLINE_WHAT[c.check]}</b></span>)}.
            </p>
            <p className="hint">Private by design: only the first 5 characters of each password’s SHA-1 hash go to Have I Been Pwned, never the password. The lists of breached sites and 2FA sites are downloaded whole and compared on this computer.</p>
          </div>
          <Button kind="primary" onClick={turnOnAll}>Turn on online checks</Button>
        </div>
      )}
      <div className="wt-grid">
        {ordered.map(c => {
          const issues = report?.issues.filter(i => i.check === c.check) ?? [];
          const off = isOff(c.check);
          if (off) {
            return (
              <div key={c.check} className={`wt-card sev-${c.severity} off`}>
                <div className="wt-card-head static">
                  <span className="wt-icon"><Ico icon={WATCHTOWER_ICONS[c.check]} size={18} /></span>
                  <span className="grow">
                    <b>{c.title}</b>
                    <span className="muted small">Off. Turn on online checks to find {ONLINE_WHAT[c.check]}.</span>
                  </span>
                  <Button small onClick={() => turnOn(c.check)}>Turn on</Button>
                </div>
              </div>
            );
          }
          // Until the first result arrives, show nothing rather than a reassuring green 0.
          const state = off ? ' off' : !report ? ' pending' : issues.length ? '' : ' ok';
          const panelId = `wt-${c.check}`;
          return (
            <div key={c.check} className={`wt-card sev-${c.severity}${state}`}>
              <button className="wt-card-head" aria-expanded={open === c.check} aria-controls={panelId} onClick={() => setOpen(open === c.check ? null : c.check)}>
                <span className="wt-icon"><Ico icon={WATCHTOWER_ICONS[c.check]} size={18} /></span>
                <span className="grow">
                  <b>{c.title}</b>
                  <span className="muted small">{c.help}</span>
                </span>
                {!off && issues.length > 0 && <span className="wt-sev">{SEVERITY_LABEL[c.severity]}</span>}
                <span className="wt-count">{off ? 'Off' : report ? issues.length : '…'}</span>
              </button>
              {open === c.check && (
                <div className="wt-list" id={panelId}>
                  {issues.length === 0 && (off
                    ? <Empty icon={CloudOff} title="This check is off"><span>It needs online checks, which are turned off.</span></Empty>
                    : <Empty icon={CircleCheck} title="All clear" />)}
                  {issues.map(iss => {
                    const item = data.items.find(i => i.id === iss.itemId);
                    if (!item) return null;
                    // Password problems go straight to the editor; the rest open the item.
                    const toEdit = ['weak', 'reused', 'vulnerable', 'compromisedWebsite', 'unsecured', 'inactive2fa'].includes(iss.check) && item.state === 'active';
                    return (
                      <button key={iss.itemId + iss.check} className="row-item" onClick={() => navigate(toEdit ? `/edit/${item.id}` : `/item/${item.id}`)}>
                        <ItemIcon item={item} />
                        <span className="row-text"><span className="row-title">{item.title}</span><span className="row-sub">{iss.detail}</span></span>
                        <span className="link with-icon">{toEdit ? 'Fix' : 'Open'}<Ico icon={ArrowRight} size={14} /></span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
