/**
 * Windows Hello through the KeyCredentialManager WinRT API, called via Windows PowerShell (always present on
 * Windows 10/11), so no native module is needed. The Hello key lives in the TPM / Hello container and only
 * signs after the user's face, fingerprint or Windows PIN.
 */
import { spawn } from 'node:child_process';

const CREDENTIAL = 'Boltwork';

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$ext = [System.WindowsRuntimeSystemExtensions]
$asTaskOp = $ext.GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${'`'}1' } | Select-Object -First 1
$asTaskAction = $ext.GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1
function Await($op, [Type]$type) { $t = $asTaskOp.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
function AwaitAction($op) { $t = $asTaskAction.Invoke($null, @($op)); $t.Wait(-1) | Out-Null }
$null = [Windows.Security.Credentials.KeyCredentialManager, Windows.Security.Credentials, ContentType = WindowsRuntime]
$null = [Windows.Security.Cryptography.CryptographicBuffer, Windows.Security.Cryptography, ContentType = WindowsRuntime]
$KCM = [Windows.Security.Credentials.KeyCredentialManager]
$req = [Console]::In.ReadToEnd() | ConvertFrom-Json
function Out($o) { [Console]::Out.Write(($o | ConvertTo-Json -Compress)) }
try {
  switch ($req.cmd) {
    'available' { Out @{ ok = $true; available = [bool](Await ($KCM::IsSupportedAsync()) ([bool])) } }
    'delete' { try { AwaitAction ($KCM::DeleteAsync('${CREDENTIAL}')) } catch {} ; Out @{ ok = $true } }
    'sign' {
      if ($req.create) {
        $r = Await ($KCM::RequestCreateAsync('${CREDENTIAL}', [Windows.Security.Credentials.KeyCredentialCreationOption]::ReplaceExisting)) ([Windows.Security.Credentials.KeyCredentialRetrievalResult])
      } else {
        $r = Await ($KCM::OpenAsync('${CREDENTIAL}')) ([Windows.Security.Credentials.KeyCredentialRetrievalResult])
      }
      if ("$($r.Status)" -ne 'Success') { Out @{ ok = $false; status = "$($r.Status)" }; break }
      $buf = [Windows.Security.Cryptography.CryptographicBuffer]::DecodeFromBase64String($req.challenge)
      $s = Await ($r.Credential.RequestSignAsync($buf)) ([Windows.Security.Credentials.KeyCredentialOperationResult])
      if ("$($s.Status)" -ne 'Success') { Out @{ ok = $false; status = "$($s.Status)" }; break }
      Out @{ ok = $true; signature = [Windows.Security.Cryptography.CryptographicBuffer]::EncodeToBase64String($s.Result) }
    }
  }
} catch { $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }; Out @{ ok = $false; status = 'Error'; detail = "$($e.Message)" } }
`;

function run(req: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') { resolve({ ok: true, available: false }); return; }
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Windows Hello didn’t respond.')); }, timeoutMs);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(out)); } catch { reject(new Error(`Windows Hello failed: ${err.trim() || out.trim() || 'no response'}`)); }
    });
    child.stdin.end(JSON.stringify(req));
  });
}

const MESSAGES: Record<string, string> = {
  UserCanceled: 'Windows Hello was cancelled.',
  NotFound: 'The Windows Hello key for Boltwork is missing. Enter your account password, then turn Windows Hello on again.',
  UserPrefersPassword: 'Windows Hello was cancelled.',
  CredentialAlreadyExists: 'A Windows Hello key for Boltwork already exists.',
  SecurityDeviceLocked: 'Windows Hello is locked after too many attempts. Use your account password.',
  NotSupported: 'Windows Hello isn’t set up on this computer.',
};

export async function helloAvailable(): Promise<boolean> {
  try { return !!(await run({ cmd: 'available' }, 20_000)).available; } catch { return false; }
}

/** Signs `challenge` with the Boltwork Hello key, showing the Windows Hello prompt. */
export async function helloSign(challenge: Uint8Array, create: boolean): Promise<Uint8Array> {
  const r = await run({ cmd: 'sign', create, challenge: Buffer.from(challenge).toString('base64') }, 120_000);
  if (!r.ok) throw new Error(MESSAGES[String(r.status)] ?? `Windows Hello failed (${r.status}${r.detail ? `: ${r.detail}` : ''}).`);
  return Uint8Array.from(Buffer.from(String(r.signature), 'base64'));
}

export async function helloDelete(): Promise<void> {
  try { await run({ cmd: 'delete' }, 20_000); } catch { /* best effort */ }
}
