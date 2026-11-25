; The Windows installer for Job Hunt. Built by .github/workflows/release.yml:
;
;   makensis /DVERSION=26.11.22 /DEXE=..\dist\JobHunt3.exe /DOUT=..\dist\JobHunt3-Setup.exe installer\jobhunt.nsi
;
; It installs for the person's own Windows account, so it never asks for an
; administrator. Their data lives elsewhere and is never touched here.

Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

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

!define NAME "Job Hunt"
; Before 26.11.52 this was "Job Hunt 3"; its install folder, program file and
; registry names keep the 3 so that updates and the person's data carry on.
!define OLDNAME "Job Hunt 3"
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

; "/S /UPDATE" is how Job Hunt updates itself: quietly, keeping the person's
; choices about the desktop shortcut and starting with Windows, and starting
; Job Hunt again afterwards.
Var Updating
Function .onInit
  StrCpy $Updating 0
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/UPDATE" $R1
  ${IfNot} ${Errors}
    StrCpy $Updating 1
  ${EndIf}
  ClearErrors
FunctionEnd
Function .onInstSuccess
  ${If} $Updating == 1
    Exec '"$INSTDIR\${PROGRAM}" -no-window'
  ${EndIf}
FunctionEnd

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

; The previous Job Hunt (the one before the rewrite) also called itself "Job
; Hunt". The first time this one takes the name, the old one's shortcuts and
; its entry in Windows' list of apps become "Job Hunt Old", so the two can be
; told apart. Nothing of it is removed or changed otherwise.
!macro RenameTheOldOne KEY
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${KEY}" "DisplayName"
  ${If} $0 == "Job Hunt"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${KEY}" "DisplayName" "Job Hunt Old"
    ${If} ${FileExists} "$SMPROGRAMS\Job Hunt.lnk"
      Rename "$SMPROGRAMS\Job Hunt.lnk" "$SMPROGRAMS\Job Hunt Old.lnk"
    ${EndIf}
    ${If} ${FileExists} "$SMPROGRAMS\Job Hunt\Job Hunt.lnk"
      Rename "$SMPROGRAMS\Job Hunt\Job Hunt.lnk" "$SMPROGRAMS\Job Hunt\Job Hunt Old.lnk"
    ${EndIf}
    ${If} ${FileExists} "$DESKTOP\Job Hunt.lnk"
      Rename "$DESKTOP\Job Hunt.lnk" "$DESKTOP\Job Hunt Old.lnk"
    ${EndIf}
  ${EndIf}
  ClearErrors
!macroend

Var HadDesktop
Section "Job Hunt" SecApp
  SectionIn RO
  !insertmacro StopRunning
  !insertmacro RenameTheOldOne "Job Hunt"
  !insertmacro RenameTheOldOne "net.jobhunt.desktop"
  ; Shortcuts made under the earlier name "Job Hunt 3" give way to the new name;
  ; a desktop shortcut the person kept is kept, under the new name.
  StrCpy $HadDesktop 0
  ${If} ${FileExists} "$DESKTOP\${OLDNAME}.lnk"
    StrCpy $HadDesktop 1
    Delete "$DESKTOP\${OLDNAME}.lnk"
  ${EndIf}
  Delete "$SMPROGRAMS\${OLDNAME}.lnk"
  SetOutPath "$INSTDIR"
  File "/oname=${PROGRAM}" "${EXE}"
  SetOutPath "$INSTDIR\extension"
  File /r /x *.go /x testpages "${EXT}\*.*"
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
  ; A click on one of Job Hunt's notifications comes back to Job Hunt, not to a browser.
  WriteRegStr HKCU "Software\Classes\jobhunt3" "" "URL:Job Hunt"
  WriteRegStr HKCU "Software\Classes\jobhunt3" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\jobhunt3\shell\open\command" "" '"$INSTDIR\${PROGRAM}" "%1"'
SectionEnd

Section "Shortcut on the desktop" SecDesktop
  ${If} $Updating != 1
  ${OrIf} $HadDesktop == 1
    CreateShortCut "$DESKTOP\${NAME}.lnk" "$INSTDIR\${PROGRAM}"
  ${EndIf}
SectionEnd

; Being early to new postings needs Job Hunt running. This starts it quietly,
; with no window, when the person signs in to Windows.
Section "Keep searching: start with Windows" SecStart
  ${If} $Updating != 1
    WriteRegStr HKCU "${RUNKEY}" "JobHunt3" '"$INSTDIR\${PROGRAM}" -no-window'
  ${EndIf}
SectionEnd

Section "Uninstall"
  !insertmacro StopRunning
  Delete "$INSTDIR\${PROGRAM}"
  RMDir /r "$INSTDIR\extension"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\${NAME}.lnk"
  Delete "$DESKTOP\${NAME}.lnk"
  Delete "$SMPROGRAMS\${OLDNAME}.lnk"
  Delete "$DESKTOP\${OLDNAME}.lnk"
  DeleteRegValue HKCU "${RUNKEY}" "JobHunt3"
  DeleteRegKey HKCU "${UNKEY}"
  DeleteRegKey HKCU "Software\Classes\jobhunt3"
  ; The person's roles, CVs and settings (in %APPDATA%\Job Hunt 3) are left alone.
SectionEnd
