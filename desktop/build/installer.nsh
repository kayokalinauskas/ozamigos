; Incluído pelo electron-builder no instalador (buildResources = build).
; O app registra os links ozamigos:// ao abrir (registrarConvites no main.js). Ao desinstalar, o registro sai junto:
; senão, clicar num convite depois abriria um app que não existe mais. Numa atualização, o desinstalador da versão
; antiga também roda; aí o registro fica, e a versão nova o refaz ao abrir.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Classes\ozamigos"
  ${endIf}
!macroend
