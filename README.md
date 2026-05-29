# esmaga.io

Comprima vídeos, imagens, PDFs e áudios sem perder qualidade. Rápido, leve e gratuito.

**Mac, Windows e Linux** · [esmaga.io](https://esmaga.io)

## O que faz

- **Vídeos** — MP4, MOV, MKV, AVI, WebM, WMV, FLV. Aceleração de hardware (VideoToolbox, NVENC).
- **Imagens** — JPG, PNG, WebP, BMP, TIFF, GIF. Qualidade configurável.
- **PDFs** — 4 níveis de compressão via Ghostscript (Tela, E-book, Impressão, Pré-impressão).
- **Áudios** — MP3, WAV, FLAC, AAC, OGG, M4A, WMA. Bitrate configurável.
- **Extrair áudio de vídeo** — extrai a trilha sonora de qualquer vídeo.
- **Converter formatos** — converte entre formatos instantaneamente (MP4↔MKV↔WebM, PNG↔WebP↔JPG, MP3↔AAC↔FLAC...).

## Features

- Drag & drop de arquivos e pastas
- Compressão paralela (1-4x simultâneo)
- Thumbnails/preview na fila
- Reordenação da fila por drag
- Monitor de CPU em tempo real
- Som de feedback ao concluir
- Notificações push ao finalizar
- Verificação de espaço em disco
- Preservação de metadados
- Decodificação por hardware (VideoToolbox, CUDA, VAAPI)
- Áudio copy quando compatível (evita re-encoding)
- Corte básico de vídeo (trim início/fim)
- Opção remover áudio
- Modo econômico (detecta hardware e limita uso de CPU/RAM)
- Tema claro/escuro
- Interface em Português e English (detecta idioma do SO)
- Dashboard de estatísticas
- Histórico de compressões
- System tray com progresso
- Auto-updater via GitHub Releases
- Single instance (evita abrir duplicado)
- Menu de contexto no Finder (macOS)
- App assinado e notarizado pela Apple

## Stack

- **Frontend:** React + TypeScript + Vite
- **Backend:** Rust (Tauri v2)
- **Vídeo/Áudio:** FFmpeg (sidecar embutido)
- **Imagens:** image crate (Rust nativo)
- **PDF:** Ghostscript
- **CI/CD:** GitHub Actions (Mac ARM/Intel, Windows, Linux)

## Rodar em desenvolvimento

```bash
npm install
npm run dev
```

Pré-requisitos: Node.js 18+, Rust, FFmpeg (`brew install ffmpeg`), Ghostscript (`brew install ghostscript`).

## Gerar build

### Mac (assinado + notarizado)

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: ..." \
APPLE_ID="seu@email.com" \
APPLE_PASSWORD="app-specific-password" \
APPLE_TEAM_ID="TEAMID" \
npm run build
```

### Via CI/CD

Push para `main` dispara build automático. Tags `v*` criam Release no GitHub.

## Downloads

- [Mac (Apple Silicon)](https://github.com/danill0muniz/esmaga.io/releases/latest)
- [Mac (Intel)](https://github.com/danill0muniz/esmaga.io/releases/latest)
- [Windows (.exe)](https://github.com/danill0muniz/esmaga.io/releases/latest)
- [Linux (.deb / .AppImage)](https://github.com/danill0muniz/esmaga.io/releases/latest)

## Licença

MIT

---

A IA trabalhou duro. O Danillo tomou café e deu ideias.
