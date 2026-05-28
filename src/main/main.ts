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

// ffmpeg-static / ffprobe-static exportam o caminho do binário.
// Em produção (empacotado com asar), o binário fica em app.asar.unpacked.
const ffmpegStatic = require('ffmpeg-static') as string;
const ffprobeStatic = require('ffprobe-static') as { path: string };

function resolveBinary(p: string): string {
  // Quando empacotado, troca app.asar por app.asar.unpacked
  if (app.isPackaged) {
    return p.replace('app.asar', 'app.asar.unpacked');
  }
  return p;
}

const FFMPEG_PATH = resolveBinary(ffmpegStatic);
const FFPROBE_PATH = resolveBinary(ffprobeStatic.path);

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

// ---------- Montagem dos argumentos do ffmpeg ----------

function crfForQuality(format: VideoFormat, quality: Quality): number {
  // H.265 usa CRF mais alto que H.264 para qualidade equivalente
  if (format === 'h265') {
    return quality === 'alta' ? 24 : quality === 'media' ? 28 : 32;
  }
  return quality === 'alta' ? 20 : quality === 'media' ? 23 : 28;
}

function scaleFilter(resolution: Resolution): string[] {
  if (resolution === '1080p') return ['-vf', 'scale=-2:1080'];
  if (resolution === '720p') return ['-vf', 'scale=-2:720'];
  return [];
}

function buildArgs(
  inputPath: string,
  outputPath: string,
  settings: CompressionSettings
): string[] {
  const codec = settings.format === 'h265' ? 'libx265' : 'libx264';
  const crf = crfForQuality(settings.format, settings.quality);
  const args = [
    '-y',
    '-i', inputPath,
    '-c:v', codec,
    '-crf', String(crf),
    '-preset', 'medium',
    ...scaleFilter(settings.resolution),
    '-c:a', 'aac',
    '-b:a', '128k',
  ];
  // hvc1 garante compatibilidade do H.265 com players da Apple
  if (settings.format === 'h265') {
    args.push('-tag:v', 'hvc1');
  }
  // -movflags +faststart deixa o MP4 pronto para streaming online
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

function compressOne(job: VideoJob, settings: CompressionSettings): Promise<number> {
  return new Promise((resolve, reject) => {
    const args = buildArgs(job.inputPath, job.outputPath, settings);
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
