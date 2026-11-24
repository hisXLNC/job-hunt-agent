; The Windows installer for Job Hunt. Built by .github/workflows/release.yml:
;
;   makensis /DVERSION=3.0.0 /DEXE=..\dist\JobHunt3.exe /DOUT=..\dist\JobHunt3-Setup.exe installer\jobhunt.nsi
;
; It installs for the person's own Windows account, so it never asks for an
; administrator. Their data lives elsewhere and is never touched here.

Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!ifndef EXE
  !define EXE "..\dist\JobHunt3.exe"
!endif
!ifndef OUT
  !define OUT "..\dist\JobHunt3-Setup.exe"
!endif
!ifndef EXT
  !define EXT "..\extension"
!endif

!define NAME "Job Hunt 3"
!define PROGRAM "JobHunt3.exe"
!define UNKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\JobHunt3"
!define RUNKEY "Software\Microsoft\Windows\CurrentVersion\Run"

Name "${NAME}"
OutFile "${OUT}"
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Programs\Job Hunt 3"
InstallDirRegKey HKCU "${UNKEY}" "InstallLocation"
SetCompressor /SOLID lzma
ShowInstDetails nevershow
ShowUninstDetails nevershow
BrandingText "Job Hunt ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${NAME}"
VIAddVersionKey "FileDescription" "Job Hunt installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" ""

!define MUI_ICON "jobhunt.ico"
!define MUI_UNICON "jobhunt.ico"
!define MUI_ABORTWARNING
!define MUI_COMPONENTSPAGE_NODESC
!define MUI_FINISHPAGE_RUN "$INSTDIR\${PROGRAM}"
!define MUI_FINISHPAGE_RUN_TEXT "Open Job Hunt"

!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

; Ask the Job Hunt that is running to stop, so its file can be replaced. It
; finishes what it is writing first. Only if it does not answer is it ended.
!macro StopRunning
  ${If} ${FileExists} "$INSTDIR\${PROGRAM}"
    nsExec::Exec '"$INSTDIR\${PROGRAM}" -quit'
    Pop $0
    nsExec::Exec 'taskkill /F /IM ${PROGRAM}'
    Pop $0
  ${EndIf}
  ClearErrors
!macroend

Section "Job Hunt" SecApp
  SectionIn RO
  !insertmacro StopRunning
  SetOutPath "$INSTDIR"
  File "/oname=${PROGRAM}" "${EXE}"
  SetOutPath "$INSTDIR\extension"
  File /r "${EXT}\*.*"
  SetOutPath "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortCut "$SMPROGRAMS\${NAME}.lnk" "$INSTDIR\${PROGRAM}"

  WriteRegStr HKCU "${UNKEY}" "DisplayName" "${NAME}"
  WriteRegStr HKCU "${UNKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNKEY}" "DisplayIcon" "$INSTDIR\${PROGRAM}"
  WriteRegStr HKCU "${UNKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNKEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNKEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${UNKEY}" "EstimatedSize" 21000
SectionEnd

Section "Shortcut on the desktop" SecDesktop
  CreateShortCut "$DESKTOP\${NAME}.lnk" "$INSTDIR\${PROGRAM}"
SectionEnd

; Being early to new postings needs Job Hunt running. This starts it quietly,
; with no window, when the person signs in to Windows.
Section "Keep searching: start with Windows" SecStart
  WriteRegStr HKCU "${RUNKEY}" "JobHunt3" '"$INSTDIR\${PROGRAM}" -no-window'
SectionEnd

Section "Uninstall"
  !insertmacro StopRunning
  Delete "$INSTDIR\${PROGRAM}"
  RMDir /r "$INSTDIR\extension"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\${NAME}.lnk"
  Delete "$DESKTOP\${NAME}.lnk"
  DeleteRegValue HKCU "${RUNKEY}" "JobHunt3"
  DeleteRegKey HKCU "${UNKEY}"
  ; The person's roles, CVs and settings (in %APPDATA%\Job Hunt 3) are left alone.
SectionEnd
