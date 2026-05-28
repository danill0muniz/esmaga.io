# Video Compressor

App de desktop (Windows e Mac) para comprimir vídeos mantendo qualidade, pronto para
hospedar online. Uso interno — sem assinatura de código.

## O que ele faz

1. Você seleciona uma **pasta** (varre todos os vídeos dentro) ou **vídeos avulsos**.
2. Cria automaticamente uma subpasta `comprimidos/` para os arquivos de saída (os
   originais nunca são tocados).
3. Opções de **formato** (MP4 H.264 / MP4 H.265), **qualidade** (alta/média/baixa) e
   **resolução** (original / 1080p / 720p).
4. Fila com **barra de progresso por vídeo** em tempo real e resumo de quanto reduziu.

O ffmpeg vem **embutido** no app (via `ffmpeg-static`), então quem usa não precisa
instalar nada.

---

## Rodar em desenvolvimento

Pré-requisito: Node.js 18+ instalado.

```bash
npm install      # baixa deps + o binário do ffmpeg automaticamente
npm run dev      # abre o app em modo dev
```

> Se o `npm install` falhar no download do ffmpeg por rede/proxy, rode de novo —
> o download é a única etapa que exige internet.

---

## Gerar o instalador

### Mac (.dmg)

```bash
npm run build:mac
```

Saída em `release/`. Como não há assinatura de código, na primeira vez o Mac vai
bloquear: clique com o **botão direito → Abrir**, ou vá em
**Ajustes → Privacidade e Segurança → Abrir Mesmo Assim**.

> Dica: gere na própria arquitetura do Mac alvo. Em Mac com chip Apple (M1/M2/M3) o
> build sai ARM; em Mac Intel, sai x64.

### Windows (.exe / instalador NSIS)

```bash
npm run build:win
```

Saída em `release/`. O SmartScreen pode avisar "app não reconhecido" — clique em
**Mais informações → Executar assim mesmo**.

> O build de Windows precisa rodar **no Windows** (ou num CI com runner Windows).
> O build de Mac precisa rodar **no Mac**. Não dá para cross-compilar os dois de uma
> máquina só sem ferramentas extras.

---

## Como ajustar a compressão

A lógica fica em `src/main/main.ts`, função `crfForQuality` e `buildArgs`:

- **CRF**: menor = mais qualidade e arquivo maior. Já calibrado por formato.
- **Preset**: está em `medium`. Troque para `slow` (menor arquivo, mais lento) ou
  `fast` (mais rápido) na função `buildArgs`.
- **Áudio**: AAC 128k, suficiente para fala. Suba para 192k se precisar.

---

## Estrutura

```
src/
  main/        processo Electron (ffmpeg, fila, IPC)
    main.ts
    preload.ts
  renderer/    interface React
    App.tsx
    main.tsx
    index.css
  shared/
    types.ts   tipos compartilhados main <-> renderer
```
