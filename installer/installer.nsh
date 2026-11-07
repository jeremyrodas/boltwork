; Boltwork's additions to the electron-builder (NSIS) installer: the optional Windows passkey helper.
;
; The helper is a separate MSIX package (Windows only accepts passkey providers from packaged apps), shipped
; inside the installer at resources\passkeys. On an upgrade it's updated quietly if it's already installed.
; Otherwise, on Windows 11 24H2 or later, the installer asks once whether to set it up; setting it up trusts
; Boltwork's signing certificate, which brings up Windows' administrator prompt.

!macro boltworkPowerShell
  ; The installer is a 32-bit program; use the 64-bit PowerShell, which has the package (Appx) commands.
  StrCpy $R9 "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
  IfFileExists "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" 0 +2
    StrCpy $R9 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
!macroend

!macro customInstall
  StrCpy $R8 "$INSTDIR\resources\passkeys\install.ps1"
  IfFileExists $R8 0 boltwork_pk_done
  ReadRegStr $R7 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentBuildNumber"
  IntCmp $R7 26100 0 boltwork_pk_done 0
  !insertmacro boltworkPowerShell

  ; Already set up: update it to the version in this installer.
  nsExec::Exec '"$R9" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$R8" -UpdateOnly'
  Pop $R6
  StrCmp $R6 "10" 0 boltwork_pk_done

  ; Not set up: offer it once (never during silent installs and updates).
  IfSilent boltwork_pk_done
  ReadRegStr $R5 HKCU "Software\Boltwork" "PasskeysOffered"
  StrCmp $R5 "1" boltwork_pk_done
  WriteRegStr HKCU "Software\Boltwork" "PasskeysOffered" "1"
  MessageBox MB_YESNO|MB_ICONQUESTION "Set up Windows passkeys too?$\r$\n$\r$\nThis lets Windows' own passkey window offer Boltwork, in any browser or app.$\r$\n$\r$\nWindows will ask for administrator permission to trust Boltwork's signing certificate. Afterwards, turn Boltwork on in the Windows settings page that opens.$\r$\n$\r$\nYou can also do this later from Boltwork: Settings, Browser Extension, Windows passkeys." /SD IDNO IDNO boltwork_pk_done
  nsExec::Exec '"$R9" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$R8"'
  Pop $R6
  StrCmp $R6 "0" boltwork_pk_done
  StrCmp $R6 "2" boltwork_pk_done
  MessageBox MB_OK|MB_ICONEXCLAMATION "Windows passkeys weren't set up (code $R6).$\r$\n$\r$\nYou can try again from Boltwork: Settings, Browser Extension, Windows passkeys. Details are in %TEMP%\boltwork-passkeys\install.log."
  boltwork_pk_done:
!macroend

!macro customUnInstall
  ; Removing Boltwork removes its passkey helper too, but not when this runs as part of an upgrade.
  ${ifNot} ${isUpdated}
    !insertmacro boltworkPowerShell
    nsExec::Exec '"$R9" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Get-AppxPackage -Name Boltwork.PasskeyProvider | Remove-AppxPackage"'
    Pop $R6
    DeleteRegValue HKCU "Software\Boltwork" "PasskeysOffered"
  ${endIf}
!macroend
