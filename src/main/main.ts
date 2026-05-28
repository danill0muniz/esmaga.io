import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, ChildProcess } from 'node:child_process';
import type {
  VideoJob,
  CompressionSettings,
  VideoFormat,
  Quality,
  Resolution,
} from '../shared/types';

// @ffmpeg-installer e @ffprobe-installer exportam o caminho do binário.
// Em produção (empacotado com asar), o binário fica em app.asar.unpacked.
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg') as { path: string };
const ffprobeInstaller = require('@ffprobe-installer/ffprobe') as { path: string };

function resolveBinary(p: string): string {
  if (app.isPackaged) {
    return p.replace('app.asar', 'app.asar.unpacked');
  }
  return p;
}

const FFMPEG_PATH = resolveBinary(ffmpegInstaller.path);
const FFPROBE_PATH = resolveBinary(ffprobeInstaller.path);

let mainWindow: BrowserWindow | null = null;
let currentProcess: ChildProcess | null = null;
let cancelled = false;

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v', '.wmv', '.flv'];

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---------- IPC: seleção de arquivos/pasta ----------

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('select-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Vídeos', extensions: VIDEO_EXTENSIONS.map((e) => e.slice(1)) }],
  });
  if (result.canceled) return [];
  return result.filePaths;
});

ipcMain.handle('scan-folder', async (_e, folderPath: string) => {
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  const videos: { path: string; size: number }[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!VIDEO_EXTENSIONS.includes(ext)) continue;
    const full = path.join(folderPath, entry.name);
    const stat = fs.statSync(full);
    videos.push({ path: full, size: stat.size });
  }
  return videos;
});

ipcMain.handle('open-folder', async (_e, folderPath: string) => {
  await shell.openPath(folderPath);
});

// ---------- ffprobe: descobrir duração ----------

function probeDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ];
    const proc = spawn(FFPROBE_PATH, args);
    let out = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.on('close', () => {
      const dur = parseFloat(out.trim());
      resolve(isNaN(dur) ? 0 : dur);
    });
    proc.on('error', () => resolve(0));
  });
}

ipcMain.handle('probe-duration', async (_e, filePath: string) => {
  return probeDuration(filePath);
});

// ---------- Detecção de hardware acceleration ----------

function detectHwEncoder(): Promise<string[]> {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG_PATH, ['-hide_banner', '-encoders']);
    let out = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.on('close', () => {
      const encoders: string[] = [];
      // Mac — VideoToolbox
      if (out.includes('h264_videotoolbox')) encoders.push('h264_videotoolbox');
      if (out.includes('hevc_videotoolbox')) encoders.push('hevc_videotoolbox');
      // Windows/Linux — NVIDIA NVENC
      if (out.includes('h264_nvenc')) encoders.push('h264_nvenc');
      if (out.includes('hevc_nvenc')) encoders.push('hevc_nvenc');
      resolve(encoders);
    });
    proc.on('error', () => resolve([]));
  });
}

let hwEncoders: string[] = [];

app.whenReady().then(async () => {
  hwEncoders = await detectHwEncoder();
});

// ---------- Montagem dos argumentos do ffmpeg ----------

function qualityForSoftware(format: VideoFormat, quality: Quality): number {
  if (format === 'h265') {
    return quality === 'alta' ? 24 : quality === 'media' ? 28 : 32;
  }
  return quality === 'alta' ? 20 : quality === 'media' ? 23 : 28;
}

// VideoToolbox e NVENC usam -q:v (escala invertida, valor menor = melhor)
function qualityForHw(quality: Quality): number {
  return quality === 'alta' ? 35 : quality === 'media' ? 50 : 65;
}

function scaleFilter(resolution: Resolution): string[] {
  if (resolution === '1080p') return ['-vf', 'scale=-2:1080'];
  if (resolution === '720p') return ['-vf', 'scale=-2:720'];
  return [];
}

function getHwEncoder(format: VideoFormat): string | null {
  if (format === 'h265') {
    if (hwEncoders.includes('hevc_videotoolbox')) return 'hevc_videotoolbox';
    if (hwEncoders.includes('hevc_nvenc')) return 'hevc_nvenc';
  } else {
    if (hwEncoders.includes('h264_videotoolbox')) return 'h264_videotoolbox';
    if (hwEncoders.includes('h264_nvenc')) return 'h264_nvenc';
  }
  return null;
}

function buildArgs(
  inputPath: string,
  outputPath: string,
  settings: CompressionSettings,
  useHw: boolean
): string[] {
  const hwEncoder = useHw ? getHwEncoder(settings.format) : null;

  const args = ['-y', '-i', inputPath];

  if (hwEncoder) {
    // Hardware acceleration
    const isNvenc = hwEncoder.includes('nvenc');
    args.push('-c:v', hwEncoder);
    if (isNvenc) {
      // NVENC usa -cq para qualidade constante
      args.push('-cq', String(qualityForHw(settings.quality)), '-preset', 'p4');
    } else {
      // VideoToolbox usa -q:v
      args.push('-q:v', String(qualityForHw(settings.quality)));
    }
  } else {
    // Software — preset fast para melhor velocidade
    const codec = settings.format === 'h265' ? 'libx265' : 'libx264';
    const crf = qualityForSoftware(settings.format, settings.quality);
    args.push('-c:v', codec, '-crf', String(crf), '-preset', 'fast');
  }

  args.push(...scaleFilter(settings.resolution), '-c:a', 'aac', '-b:a', '128k');

  if (settings.format === 'h265') {
    args.push('-tag:v', 'hvc1');
  }

  args.push('-movflags', '+faststart', outputPath);
  return args;
}

// Parser do tempo de progresso do ffmpeg (linha "time=00:00:12.34")
function parseTime(line: string): number | null {
  const m = line.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const s = parseFloat(m[3]);
  return h * 3600 + min * 60 + s;
}

function runFfmpeg(job: VideoJob, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    currentProcess = spawn(FFMPEG_PATH, args);

    currentProcess.stderr?.on('data', (data: Buffer) => {
      const line = data.toString();
      const t = parseTime(line);
      if (t !== null && job.durationSeconds > 0) {
        const pct = Math.min(99, Math.round((t / job.durationSeconds) * 100));
        mainWindow?.webContents.send('progress', { jobId: job.id, progress: pct });
      }
    });

    currentProcess.on('close', (code) => {
      currentProcess = null;
      if (cancelled) {
        reject(new Error('Cancelado'));
        return;
      }
      if (code === 0) {
        let size = 0;
        try {
          size = fs.statSync(job.outputPath).size;
        } catch {
          /* ignore */
        }
        resolve(size);
      } else {
        reject(new Error(`ffmpeg saiu com código ${code}`));
      }
    });

    currentProcess.on('error', (err) => {
      currentProcess = null;
      reject(err);
    });
  });
}

async function compressOne(job: VideoJob, settings: CompressionSettings): Promise<number> {
  const hasHw = getHwEncoder(settings.format) !== null;

  // Tenta hardware acceleration primeiro
  if (hasHw) {
    try {
      return await runFfmpeg(job, buildArgs(job.inputPath, job.outputPath, settings, true));
    } catch {
      // Fallback para software se HW falhar
      mainWindow?.webContents.send('progress', { jobId: job.id, progress: 0 });
    }
  }

  return runFfmpeg(job, buildArgs(job.inputPath, job.outputPath, settings, false));
}

// ---------- Fila ----------

ipcMain.handle(
  'start-compression',
  async (_e, jobs: VideoJob[], settings: CompressionSettings, _outputDir: string) => {
    cancelled = false;
    for (const job of jobs) {
      if (cancelled) break;
      try {
        const outputSize = await compressOne(job, settings);
        mainWindow?.webContents.send('job-done', { jobId: job.id, outputSize });
      } catch (err: any) {
        if (cancelled) break;
        mainWindow?.webContents.send('job-error', {
          jobId: job.id,
          message: err?.message ?? 'Erro desconhecido',
        });
      }
    }
  }
);

ipcMain.handle('cancel-all', async () => {
  cancelled = true;
  if (currentProcess) {
    currentProcess.kill('SIGKILL');
    currentProcess = null;
  }
});
