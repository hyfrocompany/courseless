; courseless:// on Windows.
;
; electron-builder's `protocols` key only writes CFBundleURLTypes on macOS — NSIS ignores it
; entirely and makes zero registry writes. So the scheme is registered here, by hand.
;
; SHELL_CONTEXT follows the install mode (per-user here, since nsis.perMachine is false), so the
; same macro is correct for both. "%1" must stay quoted: an unquoted path breaks on the first
; space, and the URL is attacker-shaped text. setAsDefaultProtocolClient re-writes the same keys
; on every launch, so this only has to cover the window before the first run.

!macro customInstall
  DeleteRegKey SHELL_CONTEXT "Software\Classes\courseless"
  WriteRegStr SHELL_CONTEXT "Software\Classes\courseless" "" "URL:Courseless Protocol"
  WriteRegStr SHELL_CONTEXT "Software\Classes\courseless" "URL Protocol" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\courseless\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\courseless\shell\open\command" "" '"$appExe" "%1"'
!macroend

!macro customUnInstall
  ; An update runs the OLD uninstaller first. Without this guard every update would delete the
  ; scheme it just re-registered, and deep links would die on the second release
  ; (electron-builder#2825, #7614).
  ${IfNot} ${isUpdated}
    DeleteRegKey SHELL_CONTEXT "Software\Classes\courseless"
  ${EndIf}
!macroend
