!include LogicLib.nsh

!macro APIYES_WRITE_WINDOWS_CLI
  CreateDirectory "$INSTDIR\cli"
  Delete "$INSTDIR\cli\apiyes.ps1"

  FileOpen $0 "$INSTDIR\cli\apiyes.cmd" w
  FileWrite $0 '@echo off$\r$\n'
  FileWrite $0 'setlocal$\r$\n'
  FileWrite $0 "for /f $\"tokens=2 delims=:$\" %%A in ('chcp') do set $\"_APIYES_OLD_CP=%%A$\"$\r$\n"
  FileWrite $0 'set "_APIYES_OLD_CP=%_APIYES_OLD_CP: =%"$\r$\n'
  FileWrite $0 'chcp 65001 >nul$\r$\n'
  FileWrite $0 'set "APIYES_ENV=prod"$\r$\n'
  FileWrite $0 'set "ELECTRON_RUN_AS_NODE=1"$\r$\n'
  FileWrite $0 'start "" /b /wait "%~dp0..\${APP_EXECUTABLE_FILENAME}" "%~dp0..\resources\app.asar\out\main\cli.js" --env prod %*$\r$\n'
  FileWrite $0 'set "_APIYES_EXIT=%ERRORLEVEL%"$\r$\n'
  FileWrite $0 'if defined _APIYES_OLD_CP chcp %_APIYES_OLD_CP% >nul$\r$\n'
  FileWrite $0 'exit /b %_APIYES_EXIT%$\r$\n'
  FileClose $0

  FileOpen $0 "$INSTDIR\cli\apiyes" w
  FileWrite $0 '#!/usr/bin/env sh$\n'
  FileWrite $0 'SCRIPT_DIR="$$(CDPATH= cd -- "$$(dirname -- "$$0")" && pwd)"$\n'
  FileWrite $0 'export APIYES_ENV=prod$\n'
  FileWrite $0 'export ELECTRON_RUN_AS_NODE=1$\n'
  FileWrite $0 'exec "$$SCRIPT_DIR/../${APP_EXECUTABLE_FILENAME}" "$$SCRIPT_DIR/../resources/app.asar/out/main/cli.js" --env prod "$$@"$\n'
  FileClose $0
!macroend

!macro APIYES_SET_PATH_TARGET
  ${If} $installMode == "all"
    StrCpy $1 "Machine"
  ${Else}
    StrCpy $1 "User"
  ${EndIf}
!macroend

!macro APIYES_ADD_WINDOWS_PATH
  !insertmacro APIYES_SET_PATH_TARGET

  nsExec::ExecToLog `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$$target=[EnvironmentVariableTarget]::$1; $$cli='$INSTDIR\cli'; $$path=[Environment]::GetEnvironmentVariable('Path', $$target); $$parts=@(); if ($$path) { $$parts=$$path -split ';' | Where-Object { $$_ -and ($$_ -ine $$cli) } }; $$parts += $$cli; [Environment]::SetEnvironmentVariable('Path', ($$parts -join ';'), $$target)"`
  Pop $0
  ${If} $0 != 0
    DetailPrint "Failed to update the $1 PATH for API-YES CLI (exit $0)."
  ${EndIf}

  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000

  ${IfNot} ${Silent}
    MessageBox MB_OK "API-YES CLI has been added to the $1 PATH. Open a new terminal and run: apiyes"
  ${EndIf}
!macroend

!macro APIYES_REMOVE_WINDOWS_PATH
  !insertmacro APIYES_SET_PATH_TARGET

  nsExec::ExecToLog `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$$target=[EnvironmentVariableTarget]::$1; $$cli='$INSTDIR\cli'; $$path=[Environment]::GetEnvironmentVariable('Path', $$target); if ($$path) { $$parts=$$path -split ';' | Where-Object { $$_ -and ($$_ -ine $$cli) }; [Environment]::SetEnvironmentVariable('Path', ($$parts -join ';'), $$target) }"`
  Pop $0
  ${If} $0 != 0
    DetailPrint "Failed to remove the API-YES CLI folder from the $1 PATH (exit $0)."
  ${EndIf}

  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro customInstall
  !insertmacro APIYES_WRITE_WINDOWS_CLI
  !insertmacro APIYES_ADD_WINDOWS_PATH
!macroend

!macro customUnInstall
  !insertmacro APIYES_REMOVE_WINDOWS_PATH
  RMDir /r "$INSTDIR\cli"
!macroend
