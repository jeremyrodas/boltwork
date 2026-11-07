# Installs Boltwork's Windows passkey helper (Boltwork-Passkeys.msix) from the folder this script is in.
# Run by Boltwork's installer (when you say yes, or with -UpdateOnly on upgrades) and by the app's Set up button.
#
# The package is signed with Boltwork's own certificate, which Windows only accepts once it's trusted on this
# computer. Trusting it is the one step that needs an administrator, so only that step asks (Windows' UAC prompt).
#
# Exit codes: 0 done; 2 the administrator prompt was declined; 3 the certificate isn't trusted (-UpdateOnly
# never asks); 4 trusting the certificate failed; 5 this Windows is too old; 6 installing the package failed;
# 10 nothing to update (-UpdateOnly and the helper isn't installed).
param([switch]$UpdateOnly)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$msix = Join-Path $here 'Boltwork-Passkeys.msix'
$cer = Join-Path $here 'boltwork-passkeys.cer'
$logDir = Join-Path $env:TEMP 'boltwork-passkeys'
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir 'install.log'
function Log($m) { Add-Content -Path $log -Value ("{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $m) }

try {
  $installed = Get-AppxPackage -Name 'Boltwork.PasskeyProvider'
  if ($UpdateOnly -and -not $installed) { Log 'update: helper not installed, nothing to do'; exit 10 }

  # Windows' passkey plugin interface arrived in Windows 11 24H2/25H2 (build 26100 and later).
  if ([Environment]::OSVersion.Version.Build -lt 26100) { Log "Windows build $([Environment]::OSVersion.Version.Build) is too old"; exit 5 }

  $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $cer
  $trusted = Get-ChildItem Cert:\LocalMachine\TrustedPeople | Where-Object Thumbprint -eq $cert.Thumbprint
  if (-not $trusted) {
    if ($UpdateOnly) { Log 'update: certificate not trusted'; exit 3 }
    Log "trusting certificate $($cert.Subject) $($cert.Thumbprint)"
    $quoted = $cer -replace "'", "''"
    $cmd = "Import-Certificate -FilePath '$quoted' -CertStoreLocation Cert:\LocalMachine\TrustedPeople | Out-Null"
    try {
      $p = Start-Process -FilePath "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -Verb RunAs -Wait -PassThru -WindowStyle Hidden `
        -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $cmd
    } catch { Log "administrator prompt declined: $($_.Exception.Message)"; exit 2 }
    if ($p.ExitCode -ne 0) { Log "trusting the certificate failed ($($p.ExitCode))"; exit 4 }
  }

  try {
    Add-AppxPackage -Path $msix -ForceApplicationShutdown -ForceUpdateFromAnyVersion
  } catch { Log "installing the package failed: $($_.Exception.Message)"; exit 6 }
  Log "installed $((Get-AppxPackage -Name 'Boltwork.PasskeyProvider').PackageFullName)"

  # Tells Boltwork, next time it starts, to add itself to Windows' passkey providers and open the settings page
  # where it's turned on. Not on silent updates: those keep whatever the user set up before.
  if (-not $UpdateOnly) {
    $flagDir = Join-Path $env:LOCALAPPDATA 'Boltwork'
    New-Item -ItemType Directory -Force $flagDir | Out-Null
    Set-Content -Path (Join-Path $flagDir 'passkeys-just-installed') -Value (Get-Date -Format o)
  }
  exit 0
} catch {
  Log "failed: $($_.Exception.Message)"
  exit 6
}
