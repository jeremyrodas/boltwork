import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CircleCheck, CloudOff } from 'lucide-react';
import type { WatchtowerCheck, WatchtowerReport } from '../../core/types';
import { api } from '../api';
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

export function useWatchtower() {
  const { data, settings } = useApp();
  const [report, setReport] = useState<WatchtowerReport | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true);
    try { setReport(await api.watchtower()); } finally { setBusy(false); }
  }, []);
  useEffect(() => { void refresh(); }, [data, settings?.checkVulnerable, settings?.checkCompromisedSites, settings?.check2faSites, refresh]);
  return { report, busy, refresh };
}

function scoreColor(score: number, partial: boolean) {
  if (partial) return 'var(--muted)';
  return score > 800 ? 'var(--good-text)' : score > 600 ? 'var(--strength-4)' : score > 400 ? 'var(--warn-text)' : 'var(--bad-text)';
}

export function WatchtowerView() {
  const { data, settings, navigate, updateSettings } = useApp();
  const { report, busy, refresh } = useWatchtower();
  const [open, setOpen] = useState<WatchtowerCheck | null>(null);
  if (!data || !settings) return null;
  const isOff = (c: WatchtowerCheck) => (c === 'vulnerable' && !settings.checkVulnerable) || (c === 'compromisedWebsite' && !settings.checkCompromisedSites);
  const offCount = CHECKS.filter(c => isOff(c.check)).length;
  const partial = offCount > 0;

  return (
    <section className="page">
      <div className="row between">
        <h1>Watchtower</h1>
        <Button small onClick={refresh} disabled={busy}>{busy ? 'Checking…' : 'Check again'}</Button>
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
            {partial && (
              <div className="wt-note">
                <Ico icon={CloudOff} />
                <span>
                  {offCount} breach check{offCount > 1 ? 's are' : ' is'} off, so this score leaves them out.{' '}
                  <button className="link" onClick={() => updateSettings({ checkVulnerable: true, checkCompromisedSites: true, check2faSites: true })}>Turn on online checks</button>
                  <span className="hint">Only a 5-character hash prefix of each password is sent to Have I Been Pwned; breach and 2FA lists are downloaded whole.</span>
                </span>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="wt-grid">
        {CHECKS.map(c => {
          const issues = report?.issues.filter(i => i.check === c.check) ?? [];
          const off = isOff(c.check);
          const state = off ? ' off' : issues.length ? '' : ' ok';
          const panelId = `wt-${c.check}`;
          return (
            <div key={c.check} className={`wt-card sev-${c.severity}${state}`}>
              <button className="wt-card-head" aria-expanded={open === c.check} aria-controls={panelId} onClick={() => setOpen(open === c.check ? null : c.check)}>
                <span className="wt-icon"><Ico icon={WATCHTOWER_ICONS[c.check]} size={18} /></span>
                <span className="grow">
                  <b>{c.title}</b>
                  <span className="muted small">{off ? 'Off. Turn on online checks to use this.' : c.help}</span>
                </span>
                {!off && issues.length > 0 && <span className="wt-sev">{SEVERITY_LABEL[c.severity]}</span>}
                <span className="wt-count">{off ? 'Off' : issues.length}</span>
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
