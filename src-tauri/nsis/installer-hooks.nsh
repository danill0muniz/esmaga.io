; Adiciona "Comprimir com Esmaga.io" ao menu de contexto do Windows
!macro CUSTOM_INSTALL
  ; Menu de contexto para todos os arquivos
  WriteRegStr HKCU "Software\Classes\*\shell\EsmagaIO" "" "Comprimir com Esmaga.io"
  WriteRegStr HKCU "Software\Classes\*\shell\EsmagaIO" "Icon" "$INSTDIR\Esmaga.io.exe"
  WriteRegStr HKCU "Software\Classes\*\shell\EsmagaIO\command" "" '"$INSTDIR\Esmaga.io.exe" "%1"'

  ; Menu de contexto para pastas
  WriteRegStr HKCU "Software\Classes\Directory\shell\EsmagaIO" "" "Comprimir com Esmaga.io"
  WriteRegStr HKCU "Software\Classes\Directory\shell\EsmagaIO" "Icon" "$INSTDIR\Esmaga.io.exe"
  WriteRegStr HKCU "Software\Classes\Directory\shell\EsmagaIO\command" "" '"$INSTDIR\Esmaga.io.exe" "%1"'
!macroend

!macro CUSTOM_UNINSTALL
  ; Remover entradas do registro ao desinstalar
  DeleteRegKey HKCU "Software\Classes\*\shell\EsmagaIO"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\EsmagaIO"
!macroend
