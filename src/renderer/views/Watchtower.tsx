import { useCallback, useEffect, useState } from 'react';
import type { WatchtowerCheck, WatchtowerReport } from '../../core/types';
import { api } from '../api';
import { Button, Empty, ItemIcon, timeAgo } from '../components/ui';
import { useApp } from '../state';

export const CHECKS: { check: WatchtowerCheck; title: string; icon: string; severity: 'severe' | 'attention' | 'tip'; help: string }[] = [
  { check: 'compromisedWebsite', title: 'Compromised Logins', icon: '🚨', severity: 'severe', help: 'The website reported a breach after you last changed this password.' },
  { check: 'vulnerable', title: 'Vulnerable Passwords', icon: '☣️', severity: 'severe', help: 'These passwords appeared in known data breaches.' },
  { check: 'reused', title: 'Reused Passwords', icon: '🔁', severity: 'attention', help: 'One breach could unlock all of these accounts.' },
  { check: 'weak', title: 'Weak Passwords', icon: '🧱', severity: 'attention', help: 'Easy to guess. Replace them with generated passwords.' },
  { check: 'unsecured', title: 'Unsecured Websites', icon: '🔓', severity: 'tip', help: 'These addresses use HTTP. Try switching them to HTTPS.' },
  { check: 'inactive2fa', title: 'Inactive Two-Factor Authentication', icon: '🔐', severity: 'tip', help: 'These sites support one-time codes. Turn it on and save the code here.' },
  { check: 'expiring', title: 'Expiring', icon: '⏳', severity: 'tip', help: 'Cards, passports, licenses and memberships expiring within 30 days.' },
  { check: 'duplicate', title: 'Duplicate Items', icon: '👯', severity: 'tip', help: 'Same website and username saved more than once.' },
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

function scoreColor(score: number) {
  return score > 800 ? 'var(--good)' : score > 600 ? '#65a30d' : score > 400 ? 'var(--warn)' : 'var(--bad)';
}

export function WatchtowerView() {
  const { data, settings, navigate, updateSettings } = useApp();
  const { report, busy, refresh } = useWatchtower();
  const [open, setOpen] = useState<WatchtowerCheck | null>(null);
  if (!data || !settings) return null;
  const offline = !settings.checkVulnerable || !settings.checkCompromisedSites || !settings.check2faSites;

  return (
    <section className="page">
      <div className="row between">
        <h1>Watchtower</h1>
        <Button small onClick={refresh} disabled={busy}>{busy ? 'Checking…' : 'Check again'}</Button>
      </div>
      {report && (
        <div className="wt-hero card padded">
          <div className="wt-score" style={{ borderColor: scoreColor(report.score) }}>
            <b style={{ color: scoreColor(report.score) }}>{report.score}</b><span>{report.scoreLabel}</span>
          </div>
          <div>
            <h2>Password security score</h2>
            <p className="muted">{report.issues.length === 0 ? 'No problems found. Nice work.' : `${report.issues.length} thing${report.issues.length > 1 ? 's' : ''} to look at.`} Checked {timeAgo(report.checkedAt)}.</p>
            {offline && (
              <div className="banner">
                Some checks need the internet and are off.
                <button className="link" onClick={() => updateSettings({ checkVulnerable: true, checkCompromisedSites: true, check2faSites: true })}>Turn on online checks</button>
                <span className="hint">Only a 5-character hash prefix of each password is sent to Have I Been Pwned; breach and 2FA lists are downloaded whole.</span>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="wt-grid">
        {CHECKS.map(c => {
          const issues = report?.issues.filter(i => i.check === c.check) ?? [];
          const disabled = (c.check === 'vulnerable' && !settings.checkVulnerable) || (c.check === 'compromisedWebsite' && !settings.checkCompromisedSites);
          return (
            <div key={c.check} className={`wt-card sev-${c.severity}${issues.length ? '' : ' ok'}`}>
              <button className="wt-card-head" onClick={() => setOpen(open === c.check ? null : c.check)}>
                <span className="emoji">{c.icon}</span>
                <span className="grow"><b>{c.title}</b><span className="muted small">{disabled ? 'Turn on online checks to use this' : c.help}</span></span>
                <span className="wt-count">{disabled ? '—' : issues.length}</span>
              </button>
              {open === c.check && (
                <div className="wt-list">
                  {issues.length === 0 && <Empty icon="✅" title="All clear" />}
                  {issues.map(iss => {
                    const item = data.items.find(i => i.id === iss.itemId);
                    if (!item) return null;
                    return (
                      <button key={iss.itemId + iss.check} className="row-item" onClick={() => navigate(`/item/${item.id}`)}>
                        <ItemIcon item={item} />
                        <span className="row-text"><span className="row-title">{item.title}</span><span className="row-sub">{iss.detail}</span></span>
                        <span className="link">Fix →</span>
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
