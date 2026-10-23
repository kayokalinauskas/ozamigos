<br>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/imagens/logo-tema-escuro.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/imagens/logo-tema-claro.png">
    <img src="docs/imagens/logo-tema-claro.png" alt="Ozamigos" width="340">
  </picture>
</p>

<h3 align="center">Transmita seu jogo e converse com os amigos, direto de um PC para o outro.</h3>

<p align="center">
  <a href="../../releases/latest"><img src="https://img.shields.io/badge/Baixar%20para%20Windows-b6f24a?style=for-the-badge" alt="Baixar para Windows" height="34"></a>
  <a href="https://kayokalinauskas.github.io/ozamigos/"><img src="https://img.shields.io/badge/Conhecer%20o%20site-1f261c?style=for-the-badge" alt="Conhecer o site" height="34"></a>
</p>

<p align="center">
  <a href="../../releases/latest"><img src="https://img.shields.io/github/v/release/kayokalinauskas/ozamigos?style=flat-square&label=vers%C3%A3o&color=b6f24a" alt="Última versão"></a>
  <a href="../../actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/kayokalinauskas/ozamigos/ci.yml?branch=main&style=flat-square&label=CI" alt="Estado do CI"></a>
  <img src="https://img.shields.io/badge/licen%C3%A7a-MIT-b6f24a?style=flat-square" alt="Licença MIT">
</p>

<p align="center"><img src="docs/imagens/sala-grade.png" alt="Sala com quatro transmissões ao vivo e a lista de quem está na sala" width="800"></p>

## Recursos

- Voz sempre ligada, com redução de ruído (RNNoise) e atalhos que funcionam com o jogo na frente.
- Todos podem transmitir ao mesmo tempo, em salas de até 8 pessoas.
- Grupos com nome e senha próprios.
- Chat com imagens e prévia de links.
- Reconexão automática.

## Instalação

Baixe o instalador na [última versão](../../releases/latest) e entre com o seu nome e a senha do grupo. O app se atualiza sozinho.

Pelo navegador (Chrome ou Edge), também dá para conversar, assistir e transmitir.

Requer Windows 10 (versão 2004 ou mais nova) ou Windows 11.

## Desenvolvimento

Requisitos: JDK 25 e Node.js 22. Para o app do Windows, também o .NET SDK 10.

```powershell
cd web; npm install; npm run build; cd ..
$env:OZAMIGOS_SENHA = "teste"
.\mvnw.cmd spring-boot:run
```

Abra `http://localhost:8080` e entre com a senha `teste`.

| Comando | O que faz |
|---|---|
| `.\testar.ps1` | Roda todos os testes |
| `cd desktop; npm install; npm start` | Abre o app do Windows |
| `git tag vX.Y.Z; git push origin vX.Y.Z` | Publica uma versão do app (antes, aumente a versão em `desktop/package.json`) |

Para publicar o servidor, use a imagem do `Dockerfile`, com a variável `OZAMIGOS_SENHA` e o health check em `/actuator/health`.

## Feito com

| Parte | Ferramentas |
|---|---|
| Servidor | Java 25, Spring Boot 4 (WebSocket e Actuator), imageio-webp |
| Interface | React 19, TypeScript, Vite, ícones Lucide, fontes Inter e Sora |
| Voz e vídeo | WebRTC (H.265/H.264 e Opus), RNNoise ([web-noise-suppressor](https://github.com/sapphi-red/web-noise-suppressor)) |
| Imagens do chat | libwebp, via [jSquash](https://github.com/jamsinclair/jSquash) |
| App para Windows | Electron 44, electron-builder e electron-updater |
| Som e captura do app | C# (.NET 10): Windows Graphics Capture, Direct3D 11 ([Vortice](https://github.com/amerkoleci/Vortice.Windows)) e o loopback de processo do Windows |
| Retransmissão (opcional) | TURN da Cloudflare |
| Testes | JUnit, AssertJ, Vitest e Playwright |

## Documentação

- [AGENTS.md](AGENTS.md): arquitetura, convenções e armadilhas
- [Protocolo de sinalização](docs/protocolo.md)
- [Qualidade e diagnóstico](docs/diagnostico.md)
- [Segurança](SECURITY.md)
- [Como contribuir](CONTRIBUTING.md)
- [Novidades](CHANGELOG.md)

## Licença

[MIT](LICENSE). O nome Ozamigos, o ícone e o logotipo não fazem parte da licença: numa versão modificada, use outro nome e outro ícone. Veja também as [licenças de terceiros](docs/licencas-de-terceiros.md).
