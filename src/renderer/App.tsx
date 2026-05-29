import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { check } from '@tauri-apps/plugin-updater';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { detectLang, saveLang, getTranslations, LangContext, type Lang } from './i18n';
import { useT } from './i18n';
import esmagaLogo from './esmaga.svg';

type AppMode = 'home' | 'video' | 'image' | 'pdf' | 'audio' | 'convert';
type VideoFormat = 'h264' | 'h265';
type Quality = 'alta' | 'media' | 'baixa';
type Resolution = 'original' | '1080p' | '720p';
type OutputContainer = 'mp4' | 'mkv' | 'webm';

interface CompressionSettings {
  format: VideoFormat;
  quality: Quality;
  resolution: Resolution;
  container: OutputContainer;
  removeAudio: boolean;
  trimStart?: string;
  trimEnd?: string;
  maxThreads?: number;
}

type JobStatus = 'pendente' | 'processando' | 'concluido' | 'erro';

interface VideoJob {
  id: string;
  inputPath: string;
  fileName: string;
  outputPath: string;
  status: JobStatus;
  progress: number;
  inputSize: number;
  outputSize: number;
  durationSeconds: number;
  inputFormat: string;
  errorMessage?: string;
  thumbnail?: string;
  startedAt?: number;
}

interface VideoFile {
  path: string;
  size: number;
}

type ImageOutputFormat = 'original' | 'jpg' | 'png' | 'webp';
type ImageJobStatus = 'pendente' | 'concluido' | 'erro';

interface ImageJob {
  id: string;
  inputPath: string;
  fileName: string;
  outputPath: string;
  inputSize: number;
  outputSize: number;
  outputFormat: ImageOutputFormat;
  quality: number;
  status: ImageJobStatus;
  errorMessage?: string;
  thumbnail?: string;
}

type PdfQuality = 'screen' | 'ebook' | 'printer' | 'prepress';
type PdfJobStatus = 'pendente' | 'processando' | 'concluido' | 'erro';

interface PdfJob {
  id: string;
  inputPath: string;
  fileName: string;
  outputPath: string;
  inputSize: number;
  outputSize: number;
  quality: PdfQuality;
  status: PdfJobStatus;
  progress: number;
  errorMessage?: string;
}

type AudioOutputFormat = 'mp3' | 'aac' | 'ogg' | 'flac' | 'wav';
type AudioBitrate = '128k' | '192k' | '256k' | '320k';
type AudioJobStatus = 'pendente' | 'processando' | 'concluido' | 'erro';
type AudioSubMode = 'compress' | 'extract';

interface AudioJobItem {
  id: string;
  inputPath: string;
  fileName: string;
  outputPath: string;
  inputSize: number;
  outputSize: number;
  outputFormat: AudioOutputFormat;
  bitrate: AudioBitrate;
  status: AudioJobStatus;
  progress: number;
  errorMessage?: string;
}

type OutputMode = 'same-folder' | 'always-ask' | 'fixed';

interface OutputSettings {
  mode: OutputMode;
  fixedPath: string;
}

interface HistoryEntry {
  date: string;
  fileName: string;
  inputSize: number;
  outputSize: number;
  reduction: number;
}

// ---------- Ícones SVG ----------

function IconFolder() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconVideo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
      <line x1="7" y1="2" x2="7" y2="22" />
      <line x1="17" y1="2" x2="17" y2="22" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="2" y1="7" x2="7" y2="7" />
      <line x1="2" y1="17" x2="7" y2="17" />
      <line x1="17" y1="7" x2="22" y2="7" />
      <line x1="17" y1="17" x2="22" y2="17" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function IconExternalLink() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function IconRobot() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v4" />
      <line x1="8" y1="16" x2="8" y2="16" />
      <line x1="16" y1="16" x2="16" y2="16" />
    </svg>
  );
}

function IconHistory() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconStats() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

function IconConvert() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

// ---------- Helpers ----------

function loadOutputSettings(): OutputSettings {
  try {
    const raw = localStorage.getItem('outputSettings');
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { mode: 'same-folder', fixedPath: '' };
}

function saveOutputSettings(s: OutputSettings) {
  localStorage.setItem('outputSettings', JSON.stringify(s));
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem('compressionHistory');
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function saveHistory(entries: HistoryEntry[]) {
  localStorage.setItem('compressionHistory', JSON.stringify(entries.slice(0, 100)));
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatEta(seconds: number, lang: Lang): string {
  if (seconds <= 0 || !isFinite(seconds)) return '';
  const rounded = Math.ceil(seconds / 10) * 10;
  const h = Math.floor(rounded / 3600);
  const m = Math.floor((rounded % 3600) / 60);
  const s = rounded % 60;
  if (lang === 'en') {
    if (h > 0) return `~${h}h ${m}m`;
    if (m > 0) return `~${m}m ${s}s`;
    return `~${s}s`;
  }
  if (h > 0) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

function extName(p: string): string {
  const name = baseName(p);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function changeExt(name: string, newExt: string): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.${newExt}`;
}

function dirName(p: string): string {
  const parts = p.split(/[\\/]/);
  parts.pop();
  return parts.join(p.includes('\\') ? '\\' : '/');
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  return `${dir}${sep}${name}`;
}

let idCounter = 0;
function nextId() {
  return `job-${Date.now()}-${idCounter++}`;
}

async function pickFolder(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false });
  return result ?? null;
}

async function pickFiles(): Promise<string[]> {
  const result = await open({
    multiple: true,
    filters: [{
      name: 'Vídeos',
      extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'wmv', 'flv'],
    }],
  });
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

async function pickImageFiles(): Promise<string[]> {
  const result = await open({
    multiple: true,
    filters: [{
      name: 'Imagens',
      extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif', 'gif'],
    }],
  });
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

async function pickPdfFiles(): Promise<string[]> {
  const result = await open({
    multiple: true,
    filters: [{
      name: 'PDFs',
      extensions: ['pdf'],
    }],
  });
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif', 'gif'];
const PDF_EXTS = ['pdf'];
const AUDIO_EXTS = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma'];
const VIDEO_EXTS = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'wmv', 'flv'];

async function pickAudioFiles(): Promise<string[]> {
  const result = await open({
    multiple: true,
    filters: [{
      name: 'Audio',
      extensions: AUDIO_EXTS,
    }],
  });
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

async function pickVideoFilesForExtract(): Promise<string[]> {
  const result = await open({
    multiple: true,
    filters: [{
      name: 'Videos',
      extensions: VIDEO_EXTS,
    }],
  });
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

// mapeamento de status para tradução
function statusText(status: JobStatus, t: ReturnType<typeof getTranslations>): string {
  const map: Record<JobStatus, string> = {
    pendente: t.pending,
    processando: t.processing,
    concluido: t.completed,
    erro: t.error,
  };
  return map[status];
}

// ---------- App ----------

export default function App() {
  const [mode, setMode] = useState<AppMode>('home');
  const modeRef = useRef<AppMode>('home');
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [outputDir, setOutputDir] = useState<string>('');
  const [running, setRunning] = useState(false);
  const [view, setView] = useState<'main' | 'settings' | 'history' | 'stats'>('main');
  const [outputSettings, setOutputSettingsState] = useState<OutputSettings>(loadOutputSettings);
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    try { return localStorage.getItem('notificationsEnabled') !== 'false'; } catch { return true; }
  });
  const [parallelCount, setParallelCount] = useState(() => {
    try { return parseInt(localStorage.getItem('parallelCount') || '2') || 2; } catch { return 2; }
  });
  const [ecoMode, setEcoMode] = useState(() => {
    try { return localStorage.getItem('ecoMode') === 'true'; } catch { return false; }
  });
  const [systemInfo, setSystemInfo] = useState<{ cpuCores: number; totalRamMb: number; isLowEnd: boolean; recommendedParallel: number; recommendedThreads: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [cpuUsage, setCpuUsage] = useState<number | null>(null);

  const [format, setFormat] = useState<VideoFormat>('h264');
  const [quality, setQuality] = useState<Quality>('media');
  const [resolution, setResolution] = useState<Resolution>('original');
  const [container, setContainer] = useState<OutputContainer>('mp4');
  const [removeAudio, setRemoveAudio] = useState(false);
  const [trimStart, setTrimStart] = useState('');
  const [trimEnd, setTrimEnd] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return (localStorage.getItem('appTheme') as 'dark' | 'light') || 'dark'; } catch { return 'dark'; }
  });

  const [lang, setLang] = useState<Lang>(detectLang);
  const t = useMemo(() => getTranslations(lang), [lang]);
  const changeLang = useCallback((newLang: Lang) => { setLang(newLang); saveLang(newLang); }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('appTheme', theme);
  }, [theme]);

  // Manter ref sincronizado para uso em listeners
  useEffect(() => { modeRef.current = mode; }, [mode]);

  const jobStartTimes = useRef<Record<string, number>>({});

  const toggleNotifications = useCallback((enabled: boolean) => {
    setNotificationsEnabled(enabled);
    localStorage.setItem('notificationsEnabled', String(enabled));
  }, []);

  const updateParallelCount = useCallback((count: number) => {
    setParallelCount(count);
    localStorage.setItem('parallelCount', String(count));
  }, []);

  const notifyUser = useCallback(async (title: string, body: string) => {
    if (!notificationsEnabled) return;
    let granted = await isPermissionGranted();
    if (!granted) {
      const permission = await requestPermission();
      granted = permission === 'granted';
    }
    if (granted) {
      sendNotification({ title, body });
    }
  }, [notificationsEnabled]);

  const updateOutputSettings = useCallback((s: OutputSettings) => {
    setOutputSettingsState(s);
    saveOutputSettings(s);
  }, []);

  // Detectar hardware e aplicar modo econômico
  useEffect(() => {
    invoke<{ cpuCores: number; totalRamMb: number; isLowEnd: boolean; recommendedParallel: number; recommendedThreads: number }>('get_system_info').then((info) => {
      setSystemInfo(info);
      // Auto-ativar eco mode se PC fraco e nunca foi configurado
      if (info.isLowEnd && localStorage.getItem('ecoMode') === null) {
        setEcoMode(true);
        localStorage.setItem('ecoMode', 'true');
        updateParallelCount(info.recommendedParallel);
      }
    }).catch(() => {});
  }, []);

  const toggleEcoMode = useCallback((enabled: boolean) => {
    setEcoMode(enabled);
    localStorage.setItem('ecoMode', String(enabled));
    if (enabled && systemInfo) {
      updateParallelCount(systemInfo.recommendedParallel);
    }
  }, [systemInfo, updateParallelCount]);

  // Checar atualizações
  useEffect(() => {
    check().then((update) => {
      if (update) {
        setUpdateAvailable(update.version);
      }
    }).catch(() => {});
  }, []);

  const handleUpdate = useCallback(async () => {
    try {
      setUpdating(true);
      const update = await check();
      if (update) {
        await update.downloadAndInstall();
      }
    } catch {
      setUpdating(false);
    }
  }, []);

  // Receber arquivos via linha de comando / menu de contexto
  useEffect(() => {
    const unlisten = listen<string[]>('open-files', (event) => {
      const files = event.payload;
      if (!files || files.length === 0) return;
      const ext = extName(files[0]).toLowerCase();
      const vExts = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'wmv', 'flv'];
      const iExts = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif', 'gif'];
      const aExts = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma'];
      if (ext === 'pdf') setMode('pdf');
      else if (iExts.includes(ext)) setMode('image');
      else if (aExts.includes(ext)) setMode('audio');
      else if (vExts.includes(ext)) setMode('video');
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Drag & drop (só processa vídeos quando está no modo video)
  useEffect(() => {
    const unlisten = listen<{ paths: string[] }>('tauri://drag-drop', async (event) => {
      setIsDragging(false);
      // Outros modos têm seus próprios listeners de drag-drop
      if (modeRef.current !== 'video') return;

      const paths = event.payload.paths || [];
      const videoPaths: string[] = [];
      const videoExts = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'wmv', 'flv'];

      for (const p of paths) {
        const ext = extName(p);
        if (videoExts.includes(ext)) {
          videoPaths.push(p);
        } else {
          const videos = await invoke<VideoFile[]>('scan_folder', { folderPath: p }).catch(() => []);
          videoPaths.push(...videos.map((v) => v.path));
        }
      }

      if (videoPaths.length === 0) return;

      const outDir = await resolveOutputDir(videoPaths[0]);
      if (!outDir) return;
      setOutputDir(outDir);

      const videoFiles: VideoFile[] = [];
      for (const f of videoPaths) {
        const size = await invoke<number>('get_file_size', { filePath: f });
        videoFiles.push({ path: f, size });
      }
      await addJobsFromPaths(videoFiles, outDir);
    });

    const unlistenOver = listen('tauri://drag-over', () => setIsDragging(true));
    const unlistenLeave = listen('tauri://drag-leave', () => setIsDragging(false));

    return () => {
      unlisten.then((fn) => fn());
      unlistenOver.then((fn) => fn());
      unlistenLeave.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    listen<{ jobId: string; progress: number }>('progress', (event) => {
      const { jobId, progress } = event.payload;
      setJobs((prev) =>
        prev.map((j) => {
          if (j.id !== jobId) return j;
          if (!jobStartTimes.current[jobId]) {
            jobStartTimes.current[jobId] = Date.now();
          }
          return { ...j, status: 'processando' as JobStatus, progress, startedAt: jobStartTimes.current[jobId] };
        })
      );
    }).then((fn) => unlisteners.push(fn));

    listen<{ jobId: string; outputSize: number }>('job-done', (event) => {
      const { jobId, outputSize } = event.payload;
      delete jobStartTimes.current[jobId];
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? { ...j, status: 'concluido' as JobStatus, progress: 100, outputSize }
            : j
        )
      );
    }).then((fn) => unlisteners.push(fn));

    listen<{ jobId: string; message: string }>('job-error', (event) => {
      const { jobId, message } = event.payload;
      delete jobStartTimes.current[jobId];
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, status: 'erro' as JobStatus, errorMessage: message } : j
        )
      );
    }).then((fn) => unlisteners.push(fn));

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  // Salvar histórico quando jobs terminam
  useEffect(() => {
    if (!running) return;
    const allDone = jobs.every((j) => j.status === 'concluido' || j.status === 'erro');
    if (jobs.length > 0 && allDone) {
      setRunning(false);
      const done = jobs.filter((j) => j.status === 'concluido').length;
      const errors = jobs.filter((j) => j.status === 'erro').length;
      const body = errors > 0
        ? `${done} ${t.videosCompressedErr} ${errors} ${t.withError}`
        : `${done} ${t.videosCompressedOk}`;
      notifyUser(t.compressionDone, body);
      invoke('play_completion_sound').catch(() => {});

      const history = loadHistory();
      const now = new Date().toISOString();
      const newEntries: HistoryEntry[] = jobs
        .filter((j) => j.status === 'concluido' && j.outputSize > 0)
        .map((j) => ({
          date: now,
          fileName: j.fileName,
          inputSize: j.inputSize,
          outputSize: j.outputSize,
          reduction: j.inputSize > 0 ? Math.round((1 - j.outputSize / j.inputSize) * 100) : 0,
        }));
      saveHistory([...newEntries, ...history]);
    }
  }, [jobs, running, t]);

  // Polling de CPU durante compressão
  useEffect(() => {
    if (!running) { setCpuUsage(null); return; }
    const interval = setInterval(async () => {
      const usage = await invoke<number>('get_cpu_usage').catch(() => null);
      setCpuUsage(usage);
    }, 2000);
    return () => clearInterval(interval);
  }, [running]);

  const trayKey = useMemo(
    () => jobs.map((j) => `${j.id}:${j.status}:${Math.floor(j.progress / 10) * 10}`).join(','),
    [jobs]
  );

  useEffect(() => {
    const trayJobs = jobs.map((j) => ({
      fileName: j.fileName,
      status: j.status,
      progress: j.progress,
    }));
    const timeout = setTimeout(() => {
      invoke('update_tray_menu', { jobs: trayJobs }).catch(() => {});
    }, 600);
    return () => clearTimeout(timeout);
  }, [trayKey]);

  const resolveOutputDir = useCallback(async (sourcePath: string): Promise<string | null> => {
    if (outputSettings.mode === 'fixed' && outputSettings.fixedPath) return outputSettings.fixedPath;
    if (outputSettings.mode === 'always-ask') return joinPath(dirName(sourcePath), 'comprimidos');
    return joinPath(dirName(sourcePath), 'comprimidos');
  }, [outputSettings]);

  const addJobsFromPaths = useCallback(async (items: VideoFile[], outDir: string) => {
    const newJobs: VideoJob[] = [];
    for (const item of items) {
      const fileName = baseName(item.path);
      const inputFormat = extName(item.path).toUpperCase() || '?';
      const outFileName = changeExt(fileName, container);
      const [duration, thumbnail] = await Promise.all([
        invoke<number>('probe_duration', { filePath: item.path }),
        invoke<string>('extract_thumbnail', { filePath: item.path }).catch(() => undefined),
      ]);
      newJobs.push({
        id: nextId(),
        inputPath: item.path,
        fileName,
        outputPath: joinPath(outDir, outFileName),
        status: 'pendente',
        progress: 0,
        inputSize: item.size,
        outputSize: 0,
        durationSeconds: duration,
        inputFormat,
        thumbnail,
      });
    }
    setJobs((prev) => {
      const existingPaths = new Set(prev.map(j => j.inputPath));
      const unique = newJobs.filter(j => !existingPaths.has(j.inputPath));
      return [...prev, ...unique];
    });
  }, [container]);

  const handleSelectFolder = useCallback(async () => {
    const folder = await pickFolder();
    if (!folder) return;
    const videos = await invoke<VideoFile[]>('scan_folder', { folderPath: folder });
    if (videos.length === 0) { alert(t.noVideosFound); return; }
    const outDir = await resolveOutputDir(videos[0].path);
    if (!outDir) return;
    setOutputDir(outDir);
    await addJobsFromPaths(videos, outDir);
  }, [addJobsFromPaths, resolveOutputDir, t]);

  const handleSelectFiles = useCallback(async () => {
    const files = await pickFiles();
    if (files.length === 0) return;
    const outDir = outputSettings.mode === 'fixed' && outputSettings.fixedPath
      ? outputSettings.fixedPath
      : joinPath(dirName(files[0]), 'comprimidos');
    setOutputDir(outDir);
    const videoFiles: VideoFile[] = [];
    for (const f of files) {
      const size = await invoke<number>('get_file_size', { filePath: f });
      videoFiles.push({ path: f, size });
    }
    await addJobsFromPaths(videoFiles, outDir);
  }, [addJobsFromPaths, resolveOutputDir]);

  const handleChangeOutputDir = useCallback(async () => {
    const folder = await pickFolder();
    if (!folder) return;
    setOutputDir(folder);
    setJobs((prev) => prev.map((j) => ({ ...j, outputPath: joinPath(folder, j.fileName) })));
  }, []);

  const startJobs = useCallback(async (jobsToRun: VideoJob[]) => {
    if (jobsToRun.length === 0) return;

    if (outputDir) {
      const availableBytes = await invoke<number>('check_disk_space', { folderPath: outputDir }).catch(() => 0);
      const totalInputSize = jobsToRun.reduce((s, j) => s + j.inputSize, 0);
      if (availableBytes > 0 && availableBytes < totalInputSize) {
        const available = formatBytes(availableBytes);
        const needed = formatBytes(totalInputSize);
        alert(`${t.diskSpaceTitle}\n\n${t.diskSpaceAvailable}: ${available}\n${t.diskSpaceNeeded}: ${needed}\n\n${t.diskSpaceFree}`);
        return;
      }
    }

    setRunning(true);
    const settings: CompressionSettings = {
      format, quality, resolution, container,
      removeAudio,
      trimStart: trimStart || undefined,
      trimEnd: trimEnd || undefined,
      maxThreads: ecoMode && systemInfo ? systemInfo.recommendedThreads : undefined,
    };
    const prepared = jobsToRun.map((j) => ({
      ...j,
      outputPath: joinPath(outputDir, changeExt(j.fileName, container)),
    }));
    await invoke('start_compression', { jobs: prepared, settings, outputDir, maxParallel: parallelCount });
  }, [format, quality, resolution, container, removeAudio, trimStart, trimEnd, outputDir, parallelCount, t]);

  const handleStart = useCallback(async () => {
    const pending = jobs.filter((j) => j.status === 'pendente');
    await startJobs(pending);
  }, [jobs, startJobs]);

  const handleRetry = useCallback(async () => {
    setJobs((prev) =>
      prev.map((j) =>
        j.status === 'erro'
          ? { ...j, status: 'pendente' as JobStatus, progress: 0, errorMessage: undefined }
          : j
      )
    );
    setTimeout(async () => {
      const toRetry = jobs.filter((j) => j.status === 'erro').map((j) => ({
        ...j,
        status: 'pendente' as JobStatus,
        progress: 0,
        errorMessage: undefined,
      }));
      await startJobs(toRetry);
    }, 100);
  }, [jobs, startJobs]);

  const handleCancel = useCallback(async () => {
    await invoke('cancel_all');
    setRunning(false);
    setJobs((prev) =>
      prev.map((j) =>
        j.status === 'processando' || j.status === 'pendente'
          ? { ...j, status: 'pendente' as JobStatus, progress: 0 }
          : j
      )
    );
  }, []);

  const handleRemove = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setJobs((prev) => {
        const oldIdx = prev.findIndex((j) => j.id === active.id);
        const newIdx = prev.findIndex((j) => j.id === over.id);
        return arrayMove(prev, oldIdx, newIdx);
      });
    }
  }, []);

  const handleClear = useCallback(() => {
    if (!confirm(t.confirmClear)) return;
    setJobs([]);
    setOutputDir('');
  }, [t]);

  const handleOpenOutput = useCallback(async () => {
    if (outputDir) await invoke('open_folder', { folderPath: outputDir });
  }, [outputDir]);

  const totals = useMemo(() => {
    const done = jobs.filter((j) => j.status === 'concluido');
    const totalIn = done.reduce((s, j) => s + j.inputSize, 0);
    const totalOut = done.reduce((s, j) => s + j.outputSize, 0);
    const pct = totalIn > 0 ? Math.round((1 - totalOut / totalIn) * 100) : 0;
    return { totalIn, totalOut, done: done.length, pct };
  }, [jobs]);

  const hasPending = jobs.some((j) => j.status === 'pendente');
  const hasErrors = jobs.some((j) => j.status === 'erro');

  const renderHeader = (showBack: boolean) => (
    <div className="header">
      <div className="header-row">
        {showBack ? (
          <button className="btn-back" onClick={() => setMode('home')}>
            <IconBack /> {t.backToHome}
          </button>
        ) : (
          <div className="header-brand">
            <img src={esmagaLogo} alt={t.appName} className="header-logo-svg" />
          </div>
        )}
        <div className="header-actions">
          <button
            className="btn-header-action"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? t.themeLight : t.themeDark}
          >
            {theme === 'dark' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            )}
          </button>
          <button
            className="btn-header-action"
            onClick={() => setView('history')}
            title={t.history}
          >
            <IconHistory />
          </button>
          <button
            className="btn-header-action"
            onClick={() => setView('stats')}
            title={t.stats}
          >
            <IconStats />
          </button>
          <button
            className="btn-settings"
            onClick={() => setView('settings')}
            title={t.settings}
          >
            <IconSettings />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <LangContext.Provider value={{ t, lang }}>
    <div className={`app ${isDragging ? 'dragging' : ''}`}>
      {view === 'settings' ? (
        <SettingsView
          outputSettings={outputSettings}
          onChangeOutput={updateOutputSettings}
          notificationsEnabled={notificationsEnabled}
          onToggleNotifications={toggleNotifications}
          parallelCount={parallelCount}
          onChangeParallel={updateParallelCount}
          onBack={() => setView('main')}
          lang={lang}
          changeLang={changeLang}
          theme={theme}
          onChangeTheme={setTheme}
          ecoMode={ecoMode}
          onToggleEco={toggleEcoMode}
          systemInfo={systemInfo}
        />
      ) : view === 'history' ? (
        <HistoryView onBack={() => setView('main')} />
      ) : view === 'stats' ? (
        <StatsView onBack={() => setView('main')} />
      ) : mode === 'home' ? (
      <>
      {renderHeader(false)}
      <HomeScreen onSelectMode={setMode} />
      <div className="credits">
        <div className="credits-left">
          <IconRobot /> {t.credits}
        </div>
        <div className="credits-right">
          {updateAvailable ? (
            <button
              className="credits-update"
              onClick={handleUpdate}
              disabled={updating}
            >
              {updating ? t.updatingText : `v${updateAvailable} ${t.updateAvailable}`}
            </button>
          ) : (
            <span className="credits-version">v1.7.0</span>
          )}
        </div>
      </div>
      </>
      ) : mode === 'image' ? (
      <>
      {renderHeader(true)}
      <ImageCompressor
        isDragging={isDragging}
        outputSettings={outputSettings}
        notificationsEnabled={notificationsEnabled}
        notifyUser={notifyUser}
      />
      <div className="credits">
        <div className="credits-left">
          <IconRobot /> {t.credits}
        </div>
        <div className="credits-right">
          {updateAvailable ? (
            <button
              className="credits-update"
              onClick={handleUpdate}
              disabled={updating}
            >
              {updating ? t.updatingText : `v${updateAvailable} ${t.updateAvailable}`}
            </button>
          ) : (
            <span className="credits-version">v1.7.0</span>
          )}
        </div>
      </div>
      </>
      ) : mode === 'pdf' ? (
      <>
      {renderHeader(true)}
      <PdfCompressor
        isDragging={isDragging}
        outputSettings={outputSettings}
        notificationsEnabled={notificationsEnabled}
        notifyUser={notifyUser}
      />
      <div className="credits">
        <div className="credits-left">
          <IconRobot /> {t.credits}
        </div>
        <div className="credits-right">
          {updateAvailable ? (
            <button
              className="credits-update"
              onClick={handleUpdate}
              disabled={updating}
            >
              {updating ? t.updatingText : `v${updateAvailable} ${t.updateAvailable}`}
            </button>
          ) : (
            <span className="credits-version">v1.7.0</span>
          )}
        </div>
      </div>
      </>
      ) : mode === 'audio' ? (
      <>
      {renderHeader(true)}
      <AudioCompressor
        isDragging={isDragging}
        outputSettings={outputSettings}
        notificationsEnabled={notificationsEnabled}
        notifyUser={notifyUser}
      />
      <div className="credits">
        <div className="credits-left">
          <IconRobot /> {t.credits}
        </div>
        <div className="credits-right">
          {updateAvailable ? (
            <button
              className="credits-update"
              onClick={handleUpdate}
              disabled={updating}
            >
              {updating ? t.updatingText : `v${updateAvailable} ${t.updateAvailable}`}
            </button>
          ) : (
            <span className="credits-version">v1.7.0</span>
          )}
        </div>
      </div>
      </>
      ) : mode === 'convert' ? (
      <>
      {renderHeader(true)}
      <FormatConverter
        isDragging={isDragging}
        outputSettings={outputSettings}
        notifyUser={notifyUser}
      />
      <div className="credits">
        <div className="credits-left">
          <IconRobot /> {t.credits}
        </div>
        <div className="credits-right">
          {updateAvailable ? (
            <button
              className="credits-update"
              onClick={handleUpdate}
              disabled={updating}
            >
              {updating ? t.updatingText : `v${updateAvailable} ${t.updateAvailable}`}
            </button>
          ) : (
            <span className="credits-version">v1.7.0</span>
          )}
        </div>
      </div>
      </>
      ) : (
      <>
      {renderHeader(true)}

      {isDragging && (
        <div className="drop-overlay">
          <div className="drop-content">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>{t.dropHere}</span>
          </div>
        </div>
      )}

      <div className="content">
        <div className="section">
          <div className="section-label">{t.selectVideos}</div>
          <div className="row">
            <button className="btn btn-with-icon" onClick={handleSelectFiles} disabled={running}>
              <IconVideo /> {t.selectFiles}
            </button>
            {jobs.length > 0 && !running && (
              <button className="btn" onClick={handleClear}>
                {t.clearList}
              </button>
            )}
          </div>
          <div className="hint" style={{ marginTop: 6 }}>{t.dragHint}</div>
          {outputDir && (
            <div className="hint output-dir-row">
              {t.savingTo} <strong>{outputDir}</strong>
              {!running && (
                <button className="btn btn-sm" onClick={handleChangeOutputDir}>
                  {t.change}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="section">
          <div className="section-label">{t.compressionOptions}</div>
          <div className="options">
            <div className="option-group">
              <div className="section-label">{t.codec}</div>
              <div className="pill-row">
                <Pill active={format === 'h264'} onClick={() => setFormat('h264')}>H.264</Pill>
                <Pill active={format === 'h265'} onClick={() => setFormat('h265')}>H.265</Pill>
              </div>
              <div className="hint">{t.codecHint}</div>
            </div>
            <div className="option-group">
              <div className="section-label">{t.outputFormat}</div>
              <div className="pill-row">
                <Pill active={container === 'mp4'} onClick={() => setContainer('mp4')}>.MP4</Pill>
                <Pill active={container === 'mkv'} onClick={() => setContainer('mkv')}>.MKV</Pill>
                <Pill active={container === 'webm'} onClick={() => setContainer('webm')}>.WEBM</Pill>
              </div>
              <div className="hint">{t.outputFormatHint}</div>
            </div>
            <div className="option-group">
              <div className="section-label">{t.quality}</div>
              <div className="pill-row">
                <Pill active={quality === 'alta'} onClick={() => setQuality('alta')}>{t.qualityHigh}</Pill>
                <Pill active={quality === 'media'} onClick={() => setQuality('media')}>{t.qualityMedium}</Pill>
                <Pill active={quality === 'baixa'} onClick={() => setQuality('baixa')}>{t.qualityLow}</Pill>
              </div>
              <div className="hint">{t.qualityHint}</div>
            </div>
            <div className="option-group">
              <div className="section-label">{t.resolution}</div>
              <div className="pill-row">
                <Pill active={resolution === 'original'} onClick={() => setResolution('original')}>{t.original}</Pill>
                <Pill active={resolution === '1080p'} onClick={() => setResolution('1080p')}>1080p</Pill>
                <Pill active={resolution === '720p'} onClick={() => setResolution('720p')}>720p</Pill>
              </div>
              <div className="hint">{t.resolutionHint}</div>
            </div>
          </div>

          <button className="advanced-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: showAdvanced ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
            {lang === 'pt' ? 'Configurações avançadas' : 'Advanced settings'}
          </button>

          {showAdvanced && (
            <div className="options" style={{ marginTop: 10 }}>
              <div className="option-group">
                <div className="section-label">{t.audio}</div>
                <div className="pill-row">
                  <Pill active={!removeAudio} onClick={() => setRemoveAudio(false)}>{t.audioKeep}</Pill>
                  <Pill active={removeAudio} onClick={() => setRemoveAudio(true)}>{t.audioRemove}</Pill>
                </div>
                <div className="hint">{t.audioHint}</div>
              </div>
              <div className="option-group">
                <div className="section-label">{t.trim}</div>
                <div className="trim-row">
                  <div className="trim-field">
                    <label className="hint">{t.trimStart}</label>
                    <input
                      type="text"
                      className="trim-input"
                      placeholder="00:00:00"
                      value={trimStart}
                      onChange={(e) => setTrimStart(e.target.value)}
                    />
                  </div>
                  <div className="trim-field">
                    <label className="hint">{t.trimEnd}</label>
                    <input
                      type="text"
                      className="trim-input"
                      placeholder="00:00:00"
                      value={trimEnd}
                      onChange={(e) => setTrimEnd(e.target.value)}
                    />
                  </div>
                </div>
                <div className="hint">{t.trimHint}</div>
              </div>
            </div>
          )}
        </div>

        <div className="section">
          <div className="section-label">{t.queue} ({jobs.length})</div>
          {jobs.length === 0 ? (
            <div className="empty">{t.emptyQueue}</div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={jobs.map((j) => j.id)} strategy={verticalListSortingStrategy}>
                <div className="queue">
                  {jobs.map((job) => (
                    <SortableJobRow
                      key={job.id}
                      job={job}
                      onRemove={handleRemove}
                      running={running}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>

      <div className="footer">
        <div className="summary">
          {totals.done > 0 && (
            <>
              <strong>{totals.done}</strong> {t.completedCount}
              {totals.totalIn > 0 && (
                <>
                  {' '}· {formatBytes(totals.totalIn)} → {formatBytes(totals.totalOut)}
                  {' '}· <strong className="green">−{totals.pct}%</strong>
                </>
              )}
            </>
          )}
        </div>
        <div className="row">
          {totals.done > 0 && outputDir && (
            <button className="btn btn-with-icon" onClick={handleOpenOutput}>
              <IconExternalLink /> {t.openFolder}
            </button>
          )}
          {hasErrors && !running && (
            <button className="btn btn-with-icon btn-retry" onClick={handleRetry}>
              <IconRefresh /> {t.retryFailed}
            </button>
          )}
          {running ? (
            <button className="btn btn-danger" onClick={handleCancel}>{t.cancel}</button>
          ) : (
            <button className="btn btn-primary" onClick={handleStart} disabled={!hasPending}>
              {t.compress} {jobs.filter((j) => j.status === 'pendente').length || ''}
            </button>
          )}
        </div>
      </div>

      <div className="credits">
        <div className="credits-left">
          <IconRobot /> {t.credits}
        </div>
        <div className="credits-right">
          {cpuUsage !== null && running && (
            <span className="cpu-badge">{t.cpuUsage} {Math.round(cpuUsage)}%</span>
          )}
          {updateAvailable ? (
            <button
              className="credits-update"
              onClick={handleUpdate}
              disabled={updating}
            >
              {updating ? t.updatingText : `v${updateAvailable} ${t.updateAvailable}`}
            </button>
          ) : (
            <span className="credits-version">v1.7.0</span>
          )}
        </div>
      </div>
      </>
      )}
    </div>
    </LangContext.Provider>
  );
}

// ---------- Componentes ----------

function IconBack() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function IconImage() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

function IconVideoLarge() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
      <line x1="7" y1="2" x2="7" y2="22" />
      <line x1="17" y1="2" x2="17" y2="22" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="2" y1="7" x2="7" y2="7" />
      <line x1="2" y1="17" x2="7" y2="17" />
      <line x1="17" y1="7" x2="22" y2="7" />
      <line x1="17" y1="17" x2="22" y2="17" />
    </svg>
  );
}

function IconDocument() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function IconMusic() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function HomeScreen({ onSelectMode }: { onSelectMode: (mode: AppMode) => void }) {
  const { t } = useT();
  return (
    <div className="home-screen">
      <span className="home-title">{t.selectMode}</span>
      <div className="mode-cards">
        <button className="mode-card" onClick={() => onSelectMode('video')}>
          <div className="mode-card-icon"><IconVideoLarge /></div>
          <span className="mode-card-title">{t.videoMode}</span>
          <span className="mode-card-hint">{t.videoModeHint}</span>
        </button>
        <button className="mode-card" onClick={() => onSelectMode('image')}>
          <div className="mode-card-icon"><IconImage /></div>
          <span className="mode-card-title">{t.imageMode}</span>
          <span className="mode-card-hint">{t.imageModeHint}</span>
        </button>
        <button className="mode-card" onClick={() => onSelectMode('pdf')}>
          <div className="mode-card-icon"><IconDocument /></div>
          <span className="mode-card-title">{t.pdfMode}</span>
          <span className="mode-card-hint">{t.pdfModeHint}</span>
        </button>
        <button className="mode-card" onClick={() => onSelectMode('audio')}>
          <div className="mode-card-icon"><IconMusic /></div>
          <span className="mode-card-title">{t.audioMode}</span>
          <span className="mode-card-hint">{t.audioModeHint}</span>
        </button>
        <button className="mode-card" onClick={() => onSelectMode('convert')}>
          <div className="mode-card-icon"><IconConvert /></div>
          <span className="mode-card-title">{t.convertMode}</span>
          <span className="mode-card-hint">{t.convertModeHint}</span>
        </button>
      </div>
    </div>
  );
}

function ImageCompressor({
  isDragging,
  outputSettings,
  notificationsEnabled,
  notifyUser,
}: {
  isDragging: boolean;
  outputSettings: OutputSettings;
  notificationsEnabled: boolean;
  notifyUser: (title: string, body: string) => Promise<void>;
}) {
  const { t, lang } = useT();
  const [imageJobs, setImageJobs] = useState<ImageJob[]>([]);
  const [imageOutputDir, setImageOutputDir] = useState('');
  const [imageFormat, setImageFormat] = useState<ImageOutputFormat>('original');
  const [imageQuality, setImageQuality] = useState(80);
  const [imageRunning, setImageRunning] = useState(false);

  const resolveImageOutputDir = useCallback(async (sourcePath: string): Promise<string | null> => {
    if (outputSettings.mode === 'fixed' && outputSettings.fixedPath) return outputSettings.fixedPath;
    if (outputSettings.mode === 'always-ask') return joinPath(dirName(sourcePath), 'comprimidos');
    return joinPath(dirName(sourcePath), 'comprimidos');
  }, [outputSettings]);

  const addImageJobs = useCallback(async (paths: string[], outDir: string) => {
    const newJobs: ImageJob[] = [];
    for (const p of paths) {
      const fileName = baseName(p);
      const size = await invoke<number>('get_file_size', { filePath: p });
      const ext = extName(p).toLowerCase();
      const resolvedFormat = imageFormat === 'original' ? ext : imageFormat;
      const outFileName = imageFormat === 'original' ? fileName : changeExt(fileName, imageFormat);
      const thumbnail = await invoke<string>('image_thumbnail', { filePath: p }).catch(() => undefined);
      newJobs.push({
        id: nextId(),
        inputPath: p,
        fileName,
        outputPath: joinPath(outDir, outFileName),
        inputSize: size,
        outputSize: 0,
        outputFormat: imageFormat,
        quality: imageQuality,
        status: 'pendente',
        thumbnail,
      });
    }
    setImageJobs((prev) => {
      const existingPaths = new Set(prev.map(j => j.inputPath));
      const unique = newJobs.filter(j => !existingPaths.has(j.inputPath));
      return [...prev, ...unique];
    });
  }, [imageFormat, imageQuality]);

  const handleSelectImageFolder = useCallback(async () => {
    const folder = await pickFolder();
    if (!folder) return;
    const images = await invoke<VideoFile[]>('scan_images', { folderPath: folder });
    if (images.length === 0) { alert(t.noImagesFound); return; }
    const outDir = await resolveImageOutputDir(images[0].path);
    if (!outDir) return;
    setImageOutputDir(outDir);
    await addImageJobs(images.map((i) => i.path), outDir);
  }, [addImageJobs, resolveImageOutputDir, t]);

  const handleSelectImageFiles = useCallback(async () => {
    const files = await pickImageFiles();
    if (files.length === 0) return;
    const outDir = await resolveImageOutputDir(files[0]);
    if (!outDir) return;
    setImageOutputDir(outDir);
    await addImageJobs(files, outDir);
  }, [addImageJobs, resolveImageOutputDir]);

  // Drag & drop para imagens
  useEffect(() => {
    const unlisten = listen<{ paths: string[] }>('tauri://drag-drop', async (event) => {
      const paths = event.payload.paths || [];
      const imagePaths: string[] = [];

      for (const p of paths) {
        const ext = extName(p);
        if (IMAGE_EXTS.includes(ext)) {
          imagePaths.push(p);
        } else {
          const images = await invoke<VideoFile[]>('scan_images', { folderPath: p }).catch(() => []);
          imagePaths.push(...images.map((v) => v.path));
        }
      }

      if (imagePaths.length === 0) return;

      const outDir = await resolveImageOutputDir(imagePaths[0]);
      if (!outDir) return;
      setImageOutputDir(outDir);
      await addImageJobs(imagePaths, outDir);
    });

    return () => { unlisten.then((fn) => fn()); };
  }, [addImageJobs, resolveImageOutputDir]);

  // Ouvir eventos de conclusão/erro
  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    listen<{ jobId: string; outputSize: number }>('image-done', (event) => {
      const { jobId, outputSize } = event.payload;
      setImageJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, status: 'concluido' as ImageJobStatus, outputSize } : j
        )
      );
    }).then((fn) => unlisteners.push(fn));

    listen<{ jobId: string; message: string }>('image-error', (event) => {
      const { jobId, message } = event.payload;
      setImageJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, status: 'erro' as ImageJobStatus, errorMessage: message } : j
        )
      );
    }).then((fn) => unlisteners.push(fn));

    return () => { unlisteners.forEach((fn) => fn()); };
  }, []);

  // Notificar ao concluir tudo
  useEffect(() => {
    if (!imageRunning) return;
    const allDone = imageJobs.every((j) => j.status === 'concluido' || j.status === 'erro');
    if (imageJobs.length > 0 && allDone) {
      setImageRunning(false);
      const done = imageJobs.filter((j) => j.status === 'concluido').length;
      const errors = imageJobs.filter((j) => j.status === 'erro').length;
      const body = errors > 0
        ? `${done} ${lang === 'pt' ? 'imagem(ns) comprimida(s),' : 'image(s) compressed,'} ${errors} ${lang === 'pt' ? 'com erro.' : 'with errors.'}`
        : `${done} ${lang === 'pt' ? 'imagem(ns) comprimida(s) com sucesso!' : 'image(s) compressed successfully!'}`;
      notifyUser(t.compressionDone, body);
      invoke('play_completion_sound').catch(() => {});
    }
  }, [imageJobs, imageRunning, t, lang, notifyUser]);

  const handleCompressImages = useCallback(async () => {
    const pending = imageJobs.filter((j) => j.status === 'pendente');
    if (pending.length === 0) return;

    setImageRunning(true);
    const jobsToSend = pending.map((j) => {
      const ext = extName(j.inputPath).toLowerCase();
      const resolvedFormat = j.outputFormat === 'original' ? ext : j.outputFormat;
      const outFileName = j.outputFormat === 'original' ? j.fileName : changeExt(j.fileName, j.outputFormat);
      return {
        id: j.id,
        inputPath: j.inputPath,
        fileName: j.fileName,
        outputPath: joinPath(imageOutputDir, outFileName),
        inputSize: j.inputSize,
        outputFormat: resolvedFormat,
        quality: j.quality,
      };
    });

    await invoke('compress_images', { jobs: jobsToSend });
  }, [imageJobs, imageOutputDir]);

  const handleRemoveImage = useCallback((id: string) => {
    setImageJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const imgSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEndImages = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setImageJobs((prev) => {
        const oldIdx = prev.findIndex((j) => j.id === active.id);
        const newIdx = prev.findIndex((j) => j.id === over.id);
        return arrayMove(prev, oldIdx, newIdx);
      });
    }
  }, []);

  const handleClearImages = useCallback(() => {
    if (!confirm(t.confirmClear)) return;
    setImageJobs([]);
    setImageOutputDir('');
  }, [t]);

  const handleOpenImageOutput = useCallback(async () => {
    if (imageOutputDir) await invoke('open_folder', { folderPath: imageOutputDir });
  }, [imageOutputDir]);

  const imageTotals = useMemo(() => {
    const done = imageJobs.filter((j) => j.status === 'concluido');
    const totalIn = done.reduce((s, j) => s + j.inputSize, 0);
    const totalOut = done.reduce((s, j) => s + j.outputSize, 0);
    const pct = totalIn > 0 ? Math.round((1 - totalOut / totalIn) * 100) : 0;
    return { totalIn, totalOut, done: done.length, pct };
  }, [imageJobs]);

  const hasPendingImages = imageJobs.some((j) => j.status === 'pendente');

  return (
    <>
      {isDragging && (
        <div className="drop-overlay">
          <div className="drop-content">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>{t.dropHere}</span>
          </div>
        </div>
      )}

      <div className="content">
        <div className="section">
          <div className="section-label">{t.selectImages}</div>
          <div className="row">
            <button className="btn btn-with-icon" onClick={handleSelectImageFiles} disabled={imageRunning}>
              <IconImage /> {t.selectImages}
            </button>
            {imageJobs.length > 0 && !imageRunning && (
              <button className="btn" onClick={handleClearImages}>
                {t.clearList}
              </button>
            )}
          </div>
          <div className="hint" style={{ marginTop: 6 }}>{t.dragHint}</div>
          {imageOutputDir && (
            <div className="hint output-dir-row">
              {t.savingTo} <strong>{imageOutputDir}</strong>
            </div>
          )}
        </div>

        <div className="section">
          <div className="section-label">{t.compressionOptions}</div>
          <div className="options">
            <div className="option-group">
              <div className="section-label">{t.outputFormatImage}</div>
              <div className="pill-row">
                <Pill active={imageFormat === 'original'} onClick={() => setImageFormat('original')}>{t.keepOriginalFormat}</Pill>
                <Pill active={imageFormat === 'jpg'} onClick={() => setImageFormat('jpg')}>JPG</Pill>
                <Pill active={imageFormat === 'png'} onClick={() => setImageFormat('png')}>PNG</Pill>
                <Pill active={imageFormat === 'webp'} onClick={() => setImageFormat('webp')}>WebP</Pill>
              </div>
            </div>
            <div className="option-group">
              <div className="section-label">{t.imageQuality}</div>
              <div className="pill-row">
                {[60, 70, 80, 90, 100].map((q) => (
                  <Pill key={q} active={imageQuality === q} onClick={() => setImageQuality(q)}>
                    {q}
                  </Pill>
                ))}
              </div>
              <div className="hint">{t.imageQualityHint}</div>
            </div>
          </div>
        </div>

        <div className="section">
          <div className="section-label">{t.queue} ({imageJobs.length})</div>
          {imageJobs.length === 0 ? (
            <div className="empty">{t.emptyImageQueue}</div>
          ) : (
            <DndContext sensors={imgSensors} collisionDetection={closestCenter} onDragEnd={handleDragEndImages}>
              <SortableContext items={imageJobs.map(j => j.id)} strategy={verticalListSortingStrategy}>
                <div className="queue">
                  {imageJobs.map((job) => (
                    <SortableJobWrapper key={job.id} id={job.id} canDrag={job.status === 'pendente' && !imageRunning}>
                      {(dragHandle) => (
                        <div className="job">
                          <div className="job-top">
                            {dragHandle}
                            {job.thumbnail && (
                              <img className="image-thumb" src={job.thumbnail} alt="" />
                            )}
                            <span className="job-name" title={job.fileName}>{job.fileName}</span>
                            <span className="format-badge">
                              {extName(job.inputPath).toUpperCase()}
                              {job.outputFormat !== 'original' && ` → ${job.outputFormat.toUpperCase()}`}
                            </span>
                            <span className={`status-badge status-${job.status}`}>
                              {job.status === 'pendente' ? t.pending : job.status === 'concluido' ? t.completed : t.error}
                            </span>
                            {job.status === 'concluido' && job.outputSize > 0 ? (
                              <span className="job-meta">
                                {formatBytes(job.inputSize)} → {formatBytes(job.outputSize)}
                                {job.inputSize > 0 && (
                                  <span className="green"> −{Math.round((1 - job.outputSize / job.inputSize) * 100)}%</span>
                                )}
                              </span>
                            ) : (
                              <span className="job-meta">{job.inputSize > 0 ? formatBytes(job.inputSize) : ''}</span>
                            )}
                            {job.status === 'pendente' && !imageRunning && (
                              <button className="remove-btn" onClick={() => handleRemoveImage(job.id)} title={t.remove}>✕</button>
                            )}
                          </div>
                          {job.status === 'erro' && job.errorMessage && (
                            <div className="job-error">{job.errorMessage}</div>
                          )}
                        </div>
                      )}
                    </SortableJobWrapper>
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>

      <div className="footer">
        <div className="summary">
          {imageTotals.done > 0 && (
            <>
              <strong>{imageTotals.done}</strong> {t.completedCount}
              {imageTotals.totalIn > 0 && (
                <>
                  {' '}· {formatBytes(imageTotals.totalIn)} → {formatBytes(imageTotals.totalOut)}
                  {' '}· <strong className="green">−{imageTotals.pct}%</strong>
                </>
              )}
            </>
          )}
        </div>
        <div className="row">
          {imageTotals.done > 0 && imageOutputDir && (
            <button className="btn btn-with-icon" onClick={handleOpenImageOutput}>
              <IconExternalLink /> {t.openFolder}
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={handleCompressImages}
            disabled={!hasPendingImages || imageRunning}
          >
            {t.compressImages} {imageJobs.filter((j) => j.status === 'pendente').length || ''}
          </button>
        </div>
      </div>
    </>
  );
}

function PdfCompressor({
  isDragging,
  outputSettings,
  notificationsEnabled,
  notifyUser,
}: {
  isDragging: boolean;
  outputSettings: OutputSettings;
  notificationsEnabled: boolean;
  notifyUser: (title: string, body: string) => Promise<void>;
}) {
  const { t, lang } = useT();
  const [pdfJobs, setPdfJobs] = useState<PdfJob[]>([]);
  const [pdfOutputDir, setPdfOutputDir] = useState('');
  const [pdfQuality, setPdfQuality] = useState<PdfQuality>('ebook');
  const [pdfRunning, setPdfRunning] = useState(false);

  const resolvePdfOutputDir = useCallback(async (sourcePath: string): Promise<string | null> => {
    if (outputSettings.mode === 'fixed' && outputSettings.fixedPath) return outputSettings.fixedPath;
    if (outputSettings.mode === 'always-ask') return joinPath(dirName(sourcePath), 'comprimidos');
    return joinPath(dirName(sourcePath), 'comprimidos');
  }, [outputSettings]);

  const addPdfJobs = useCallback(async (paths: string[], outDir: string) => {
    const newJobs: PdfJob[] = [];
    for (const p of paths) {
      const fileName = baseName(p);
      const size = await invoke<number>('get_file_size', { filePath: p });
      newJobs.push({
        id: nextId(),
        inputPath: p,
        fileName,
        outputPath: joinPath(outDir, fileName),
        inputSize: size,
        outputSize: 0,
        quality: pdfQuality,
        status: 'pendente',
        progress: 0,
      });
    }
    setPdfJobs((prev) => {
      const existingPaths = new Set(prev.map(j => j.inputPath));
      const unique = newJobs.filter(j => !existingPaths.has(j.inputPath));
      return [...prev, ...unique];
    });
  }, [pdfQuality]);

  const handleSelectPdfFolder = useCallback(async () => {
    const folder = await pickFolder();
    if (!folder) return;
    const pdfs = await invoke<VideoFile[]>('scan_pdfs', { folderPath: folder });
    if (pdfs.length === 0) { alert(t.noPdfsFound); return; }
    const outDir = await resolvePdfOutputDir(pdfs[0].path);
    if (!outDir) return;
    setPdfOutputDir(outDir);
    await addPdfJobs(pdfs.map((p) => p.path), outDir);
  }, [addPdfJobs, resolvePdfOutputDir, t]);

  const handleSelectPdfFiles = useCallback(async () => {
    const files = await pickPdfFiles();
    if (files.length === 0) return;
    const outDir = await resolvePdfOutputDir(files[0]);
    if (!outDir) return;
    setPdfOutputDir(outDir);
    await addPdfJobs(files, outDir);
  }, [addPdfJobs, resolvePdfOutputDir]);

  // Drag & drop para PDFs
  useEffect(() => {
    const unlisten = listen<{ paths: string[] }>('tauri://drag-drop', async (event) => {
      const paths = event.payload.paths || [];
      const pdfPaths: string[] = [];

      for (const p of paths) {
        const ext = extName(p);
        if (PDF_EXTS.includes(ext)) {
          pdfPaths.push(p);
        } else {
          const pdfs = await invoke<VideoFile[]>('scan_pdfs', { folderPath: p }).catch(() => []);
          pdfPaths.push(...pdfs.map((v) => v.path));
        }
      }

      if (pdfPaths.length === 0) return;

      const outDir = await resolvePdfOutputDir(pdfPaths[0]);
      if (!outDir) return;
      setPdfOutputDir(outDir);
      await addPdfJobs(pdfPaths, outDir);
    });

    return () => { unlisten.then((fn) => fn()); };
  }, [addPdfJobs, resolvePdfOutputDir]);

  // Ouvir eventos de conclusão/erro
  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    listen<{ jobId: string; progress: number }>('pdf-progress', (event) => {
      const { jobId } = event.payload;
      setPdfJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, status: 'processando' as PdfJobStatus, progress: 0 } : j
        )
      );
    }).then((fn) => unlisteners.push(fn));

    listen<{ jobId: string; outputSize: number }>('pdf-done', (event) => {
      const { jobId, outputSize } = event.payload;
      setPdfJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, status: 'concluido' as PdfJobStatus, outputSize, progress: 100 } : j
        )
      );
    }).then((fn) => unlisteners.push(fn));

    listen<{ jobId: string; message: string }>('pdf-error', (event) => {
      const { jobId, message } = event.payload;
      setPdfJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, status: 'erro' as PdfJobStatus, errorMessage: message } : j
        )
      );
    }).then((fn) => unlisteners.push(fn));

    return () => { unlisteners.forEach((fn) => fn()); };
  }, []);

  // Notificar ao concluir tudo
  useEffect(() => {
    if (!pdfRunning) return;
    const allDone = pdfJobs.every((j) => j.status === 'concluido' || j.status === 'erro');
    if (pdfJobs.length > 0 && allDone) {
      setPdfRunning(false);
      const done = pdfJobs.filter((j) => j.status === 'concluido').length;
      const errors = pdfJobs.filter((j) => j.status === 'erro').length;
      const body = errors > 0
        ? `${done} PDF(s) ${lang === 'pt' ? 'comprimido(s),' : 'compressed,'} ${errors} ${lang === 'pt' ? 'com erro.' : 'with errors.'}`
        : `${done} PDF(s) ${lang === 'pt' ? 'comprimido(s) com sucesso!' : 'compressed successfully!'}`;
      notifyUser(t.compressionDone, body);
      invoke('play_completion_sound').catch(() => {});
    }
  }, [pdfJobs, pdfRunning, t, lang, notifyUser]);

  const handleCompressPdfs = useCallback(async () => {
    const pending = pdfJobs.filter((j) => j.status === 'pendente');
    if (pending.length === 0) return;

    setPdfRunning(true);
    const jobsToSend = pending.map((j) => ({
      id: j.id,
      inputPath: j.inputPath,
      fileName: j.fileName,
      outputPath: joinPath(pdfOutputDir, j.fileName),
      inputSize: j.inputSize,
      quality: j.quality,
    }));

    await invoke('compress_pdfs', { jobs: jobsToSend });
  }, [pdfJobs, pdfOutputDir]);

  const handleRemovePdf = useCallback((id: string) => {
    setPdfJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const pdfSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEndPdfs = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setPdfJobs((prev) => {
        const oldIdx = prev.findIndex((j) => j.id === active.id);
        const newIdx = prev.findIndex((j) => j.id === over.id);
        return arrayMove(prev, oldIdx, newIdx);
      });
    }
  }, []);

  const handleClearPdfs = useCallback(() => {
    if (!confirm(t.confirmClear)) return;
    setPdfJobs([]);
    setPdfOutputDir('');
  }, [t]);

  const handleOpenPdfOutput = useCallback(async () => {
    if (pdfOutputDir) await invoke('open_folder', { folderPath: pdfOutputDir });
  }, [pdfOutputDir]);

  const pdfTotals = useMemo(() => {
    const done = pdfJobs.filter((j) => j.status === 'concluido');
    const totalIn = done.reduce((s, j) => s + j.inputSize, 0);
    const totalOut = done.reduce((s, j) => s + j.outputSize, 0);
    const pct = totalIn > 0 ? Math.round((1 - totalOut / totalIn) * 100) : 0;
    return { totalIn, totalOut, done: done.length, pct };
  }, [pdfJobs]);

  const hasPendingPdfs = pdfJobs.some((j) => j.status === 'pendente');

  return (
    <>
      {isDragging && (
        <div className="drop-overlay">
          <div className="drop-content">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>{t.dropHere}</span>
          </div>
        </div>
      )}

      <div className="content">
        <div className="section">
          <div className="section-label">{t.selectPdfs}</div>
          <div className="row">
            <button className="btn btn-with-icon" onClick={handleSelectPdfFiles} disabled={pdfRunning}>
              <IconDocument /> {t.selectPdfs}
            </button>
            {pdfJobs.length > 0 && !pdfRunning && (
              <button className="btn" onClick={handleClearPdfs}>
                {t.clearList}
              </button>
            )}
          </div>
          <div className="hint" style={{ marginTop: 6 }}>{t.dragHint}</div>
          {pdfOutputDir && (
            <div className="hint output-dir-row">
              {t.savingTo} <strong>{pdfOutputDir}</strong>
            </div>
          )}
        </div>

        <div className="section">
          <div className="section-label">{t.compressionOptions}</div>
          <div className="options">
            <div className="option-group">
              <div className="section-label">{t.pdfQuality}</div>
              <div className="pill-row">
                <Pill active={pdfQuality === 'screen'} onClick={() => setPdfQuality('screen')}>{t.pdfScreen}</Pill>
                <Pill active={pdfQuality === 'ebook'} onClick={() => setPdfQuality('ebook')}>{t.pdfEbook}</Pill>
                <Pill active={pdfQuality === 'printer'} onClick={() => setPdfQuality('printer')}>{t.pdfPrinter}</Pill>
                <Pill active={pdfQuality === 'prepress'} onClick={() => setPdfQuality('prepress')}>{t.pdfPrepress}</Pill>
              </div>
              <div className="hint">{t.pdfQualityHint}</div>
            </div>
          </div>
        </div>

        <div className="section">
          <div className="section-label">{t.queue} ({pdfJobs.length})</div>
          {pdfJobs.length === 0 ? (
            <div className="empty">{t.emptyPdfQueue}</div>
          ) : (
            <DndContext sensors={pdfSensors} collisionDetection={closestCenter} onDragEnd={handleDragEndPdfs}>
              <SortableContext items={pdfJobs.map(j => j.id)} strategy={verticalListSortingStrategy}>
                <div className="queue">
                  {pdfJobs.map((job) => (
                    <SortableJobWrapper key={job.id} id={job.id} canDrag={job.status === 'pendente' && !pdfRunning}>
                      {(dragHandle) => (
                        <div className="job">
                          <div className="job-top">
                            {dragHandle}
                            <span className="job-name" title={job.fileName}>{job.fileName}</span>
                            <span className="format-badge">PDF</span>
                            <span className={`status-badge status-${job.status}`}>
                              {job.status === 'pendente' ? t.pending : job.status === 'processando' ? t.processing : job.status === 'concluido' ? t.completed : t.error}
                            </span>
                            {job.status === 'concluido' && job.outputSize > 0 ? (
                              <span className="job-meta">
                                {formatBytes(job.inputSize)} → {formatBytes(job.outputSize)}
                                {job.inputSize > 0 && (
                                  <span className="green"> −{Math.round((1 - job.outputSize / job.inputSize) * 100)}%</span>
                                )}
                              </span>
                            ) : (
                              <span className="job-meta">{job.inputSize > 0 ? formatBytes(job.inputSize) : ''}</span>
                            )}
                            {job.status === 'pendente' && !pdfRunning && (
                              <button className="remove-btn" onClick={() => handleRemovePdf(job.id)} title={t.remove}>✕</button>
                            )}
                          </div>
                          {job.status === 'processando' && (
                            <div className="progress-track">
                              <div className="progress-fill progress-indeterminate" />
                            </div>
                          )}
                          {job.status === 'erro' && job.errorMessage && (
                            <div className="job-error">{job.errorMessage}</div>
                          )}
                        </div>
                      )}
                    </SortableJobWrapper>
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>

      <div className="footer">
        <div className="summary">
          {pdfTotals.done > 0 && (
            <>
              <strong>{pdfTotals.done}</strong> {t.completedCount}
              {pdfTotals.totalIn > 0 && (
                <>
                  {' '}· {formatBytes(pdfTotals.totalIn)} → {formatBytes(pdfTotals.totalOut)}
                  {' '}· <strong className="green">−{pdfTotals.pct}%</strong>
                </>
              )}
            </>
          )}
        </div>
        <div className="row">
          {pdfTotals.done > 0 && pdfOutputDir && (
            <button className="btn btn-with-icon" onClick={handleOpenPdfOutput}>
              <IconExternalLink /> {t.openFolder}
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={handleCompressPdfs}
            disabled={!hasPendingPdfs || pdfRunning}
          >
            {t.compressPdfs} {pdfJobs.filter((j) => j.status === 'pendente').length || ''}
          </button>
        </div>
      </div>
    </>
  );
}

function AudioCompressor({
  isDragging,
  outputSettings,
  notificationsEnabled,
  notifyUser,
}: {
  isDragging: boolean;
  outputSettings: OutputSettings;
  notificationsEnabled: boolean;
  notifyUser: (title: string, body: string) => Promise<void>;
}) {
  const { t, lang } = useT();
  const [audioJobs, setAudioJobs] = useState<AudioJobItem[]>([]);
  const [audioOutputDir, setAudioOutputDir] = useState('');
  const [audioFormat, setAudioFormat] = useState<AudioOutputFormat>('mp3');
  const [audioBitrate, setAudioBitrate] = useState<AudioBitrate>('192k');
  const [audioRunning, setAudioRunning] = useState(false);
  const [audioSubMode, setAudioSubMode] = useState<AudioSubMode>('compress');

  const resolveAudioOutputDir = useCallback(async (sourcePath: string): Promise<string | null> => {
    if (outputSettings.mode === 'fixed' && outputSettings.fixedPath) return outputSettings.fixedPath;
    if (outputSettings.mode === 'always-ask') return joinPath(dirName(sourcePath), 'comprimidos');
    return joinPath(dirName(sourcePath), 'comprimidos');
  }, [outputSettings]);

  const addAudioJobs = useCallback(async (paths: string[], outDir: string) => {
    const newJobs: AudioJobItem[] = [];
    for (const p of paths) {
      const fileName = baseName(p);
      const size = await invoke<number>('get_file_size', { filePath: p });
      const outFileName = changeExt(fileName, audioFormat);
      newJobs.push({
        id: nextId(),
        inputPath: p,
        fileName,
        outputPath: joinPath(outDir, outFileName),
        inputSize: size,
        outputSize: 0,
        outputFormat: audioFormat,
        bitrate: audioBitrate,
        status: 'pendente',
        progress: 0,
      });
    }
    setAudioJobs((prev) => {
      const existingPaths = new Set(prev.map(j => j.inputPath));
      const unique = newJobs.filter(j => !existingPaths.has(j.inputPath));
      return [...prev, ...unique];
    });
  }, [audioFormat, audioBitrate]);

  const handleSelectAudioFolder = useCallback(async () => {
    const folder = await pickFolder();
    if (!folder) return;
    const audios = await invoke<VideoFile[]>('scan_audio', { folderPath: folder });
    if (audios.length === 0) { alert(t.noAudioFound); return; }
    const outDir = await resolveAudioOutputDir(audios[0].path);
    if (!outDir) return;
    setAudioOutputDir(outDir);
    await addAudioJobs(audios.map((a) => a.path), outDir);
  }, [addAudioJobs, resolveAudioOutputDir, t]);

  const handleSelectAudioFiles = useCallback(async () => {
    const files = await pickAudioFiles();
    if (files.length === 0) return;
    const outDir = await resolveAudioOutputDir(files[0]);
    if (!outDir) return;
    setAudioOutputDir(outDir);
    await addAudioJobs(files, outDir);
  }, [addAudioJobs, resolveAudioOutputDir]);

  const handleSelectVideoFiles = useCallback(async () => {
    const files = await pickVideoFilesForExtract();
    if (files.length === 0) return;
    const outDir = await resolveAudioOutputDir(files[0]);
    if (!outDir) return;
    setAudioOutputDir(outDir);
    await addAudioJobs(files, outDir);
  }, [addAudioJobs, resolveAudioOutputDir]);

  // Drag & drop
  useEffect(() => {
    const unlisten = listen<{ paths: string[] }>('tauri://drag-drop', async (event) => {
      const paths = event.payload.paths || [];
      const validPaths: string[] = [];
      const allowedExts = audioSubMode === 'compress' ? AUDIO_EXTS : VIDEO_EXTS;

      for (const p of paths) {
        const ext = extName(p);
        if (allowedExts.includes(ext)) {
          validPaths.push(p);
        } else if (audioSubMode === 'compress') {
          const audios = await invoke<VideoFile[]>('scan_audio', { folderPath: p }).catch(() => []);
          validPaths.push(...audios.map((v) => v.path));
        }
      }

      if (validPaths.length === 0) return;

      const outDir = await resolveAudioOutputDir(validPaths[0]);
      if (!outDir) return;
      setAudioOutputDir(outDir);
      await addAudioJobs(validPaths, outDir);
    });

    return () => { unlisten.then((fn) => fn()); };
  }, [addAudioJobs, resolveAudioOutputDir, audioSubMode]);

  // Ouvir eventos de conclusão/erro
  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    listen<{ jobId: string; progress: number }>('audio-progress', (event) => {
      const { jobId, progress } = event.payload;
      setAudioJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, status: 'processando' as AudioJobStatus, progress } : j
        )
      );
    }).then((fn) => unlisteners.push(fn));

    listen<{ jobId: string; outputSize: number }>('audio-done', (event) => {
      const { jobId, outputSize } = event.payload;
      setAudioJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, status: 'concluido' as AudioJobStatus, outputSize, progress: 100 } : j
        )
      );
    }).then((fn) => unlisteners.push(fn));

    listen<{ jobId: string; message: string }>('audio-error', (event) => {
      const { jobId, message } = event.payload;
      setAudioJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, status: 'erro' as AudioJobStatus, errorMessage: message } : j
        )
      );
    }).then((fn) => unlisteners.push(fn));

    return () => { unlisteners.forEach((fn) => fn()); };
  }, []);

  // Notificar ao concluir tudo
  useEffect(() => {
    if (!audioRunning) return;
    const allDone = audioJobs.every((j) => j.status === 'concluido' || j.status === 'erro');
    if (audioJobs.length > 0 && allDone) {
      setAudioRunning(false);
      const done = audioJobs.filter((j) => j.status === 'concluido').length;
      const errors = audioJobs.filter((j) => j.status === 'erro').length;
      const body = errors > 0
        ? `${done} ${lang === 'pt' ? 'áudio(s) processado(s),' : 'audio file(s) processed,'} ${errors} ${lang === 'pt' ? 'com erro.' : 'with errors.'}`
        : `${done} ${lang === 'pt' ? 'áudio(s) processado(s) com sucesso!' : 'audio file(s) processed successfully!'}`;
      notifyUser(t.compressionDone, body);
      invoke('play_completion_sound').catch(() => {});
    }
  }, [audioJobs, audioRunning, t, lang, notifyUser]);

  const handleCompressAudio = useCallback(async () => {
    const pending = audioJobs.filter((j) => j.status === 'pendente');
    if (pending.length === 0) return;

    setAudioRunning(true);

    if (audioSubMode === 'compress') {
      const jobsToSend = pending.map((j) => ({
        id: j.id,
        inputPath: j.inputPath,
        fileName: j.fileName,
        outputPath: joinPath(audioOutputDir, changeExt(j.fileName, j.outputFormat)),
        inputSize: j.inputSize,
        outputFormat: j.outputFormat,
        bitrate: j.bitrate,
      }));
      await invoke('compress_audio', { jobs: jobsToSend });
    } else {
      const jobsToSend = pending.map((j) => ({
        id: j.id,
        inputPath: j.inputPath,
        fileName: j.fileName,
        outputPath: joinPath(audioOutputDir, changeExt(j.fileName, j.outputFormat)),
        inputSize: j.inputSize,
        outputFormat: j.outputFormat,
        bitrate: j.bitrate,
      }));
      await invoke('extract_audio_from_video', { jobs: jobsToSend });
    }
  }, [audioJobs, audioOutputDir, audioSubMode]);

  const handleRemoveAudioJob = useCallback((id: string) => {
    setAudioJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const audioSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEndAudio = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setAudioJobs((prev) => {
        const oldIdx = prev.findIndex((j) => j.id === active.id);
        const newIdx = prev.findIndex((j) => j.id === over.id);
        return arrayMove(prev, oldIdx, newIdx);
      });
    }
  }, []);

  const handleClearAudio = useCallback(() => {
    if (!confirm(t.confirmClear)) return;
    setAudioJobs([]);
    setAudioOutputDir('');
  }, [t]);

  const handleOpenAudioOutput = useCallback(async () => {
    if (audioOutputDir) await invoke('open_folder', { folderPath: audioOutputDir });
  }, [audioOutputDir]);

  const audioTotals = useMemo(() => {
    const done = audioJobs.filter((j) => j.status === 'concluido');
    const totalIn = done.reduce((s, j) => s + j.inputSize, 0);
    const totalOut = done.reduce((s, j) => s + j.outputSize, 0);
    const pct = totalIn > 0 ? Math.round((1 - totalOut / totalIn) * 100) : 0;
    return { totalIn, totalOut, done: done.length, pct };
  }, [audioJobs]);

  const hasPendingAudio = audioJobs.some((j) => j.status === 'pendente');

  const handleSwitchSubMode = useCallback((sub: AudioSubMode) => {
    if (audioRunning) return;
    setAudioSubMode(sub);
    setAudioJobs([]);
    setAudioOutputDir('');
  }, [audioRunning]);

  return (
    <>
      {isDragging && (
        <div className="drop-overlay">
          <div className="drop-content">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>{t.dropHere}</span>
          </div>
        </div>
      )}

      <div className="content">
        <div className="tab-row">
          <button
            className={`tab-btn ${audioSubMode === 'compress' ? 'active' : ''}`}
            onClick={() => handleSwitchSubMode('compress')}
          >
            {t.audioTab}
          </button>
          <button
            className={`tab-btn ${audioSubMode === 'extract' ? 'active' : ''}`}
            onClick={() => handleSwitchSubMode('extract')}
          >
            {t.extractTab}
          </button>
        </div>

        <div className="section">
          <div className="section-label">
            {audioSubMode === 'compress' ? t.selectAudio : t.extractAudio}
          </div>
          <div className="row">
            {audioSubMode === 'compress' ? (
              <button className="btn btn-with-icon" onClick={handleSelectAudioFiles} disabled={audioRunning}>
                <IconMusic /> {t.selectAudio}
              </button>
            ) : (
              <button className="btn btn-with-icon" onClick={handleSelectVideoFiles} disabled={audioRunning}>
                <IconVideoLarge /> {t.extractAudio}
              </button>
            )}
            {audioJobs.length > 0 && !audioRunning && (
              <button className="btn" onClick={handleClearAudio}>
                {t.clearList}
              </button>
            )}
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            {audioSubMode === 'compress' ? t.dragHint : t.extractAudioHint}
          </div>
          {audioOutputDir && (
            <div className="hint output-dir-row">
              {t.savingTo} <strong>{audioOutputDir}</strong>
            </div>
          )}
        </div>

        <div className="section">
          <div className="section-label">{t.compressionOptions}</div>
          <div className="options">
            <div className="option-group">
              <div className="section-label">{t.audioFormat}</div>
              <div className="pill-row">
                <Pill active={audioFormat === 'mp3'} onClick={() => setAudioFormat('mp3')}>MP3</Pill>
                <Pill active={audioFormat === 'aac'} onClick={() => setAudioFormat('aac')}>AAC</Pill>
                <Pill active={audioFormat === 'ogg'} onClick={() => setAudioFormat('ogg')}>OGG</Pill>
                <Pill active={audioFormat === 'flac'} onClick={() => setAudioFormat('flac')}>FLAC</Pill>
                <Pill active={audioFormat === 'wav'} onClick={() => setAudioFormat('wav')}>WAV</Pill>
              </div>
            </div>
            {audioFormat !== 'flac' && audioFormat !== 'wav' && (
              <div className="option-group">
                <div className="section-label">{t.audioBitrate}</div>
                <div className="pill-row">
                  <Pill active={audioBitrate === '128k'} onClick={() => setAudioBitrate('128k')}>128k</Pill>
                  <Pill active={audioBitrate === '192k'} onClick={() => setAudioBitrate('192k')}>192k</Pill>
                  <Pill active={audioBitrate === '256k'} onClick={() => setAudioBitrate('256k')}>256k</Pill>
                  <Pill active={audioBitrate === '320k'} onClick={() => setAudioBitrate('320k')}>320k</Pill>
                </div>
                <div className="hint">{t.audioBitrateHint}</div>
              </div>
            )}
          </div>
        </div>

        <div className="section">
          <div className="section-label">{t.queue} ({audioJobs.length})</div>
          {audioJobs.length === 0 ? (
            <div className="empty">{t.emptyAudioQueue}</div>
          ) : (
            <DndContext sensors={audioSensors} collisionDetection={closestCenter} onDragEnd={handleDragEndAudio}>
              <SortableContext items={audioJobs.map(j => j.id)} strategy={verticalListSortingStrategy}>
                <div className="queue">
                  {audioJobs.map((job) => (
                    <SortableJobWrapper key={job.id} id={job.id} canDrag={job.status === 'pendente' && !audioRunning}>
                      {(dragHandle) => (
                        <div className="job">
                          <div className="job-top">
                            {dragHandle}
                            <span className="job-name" title={job.fileName}>{job.fileName}</span>
                            <span className="format-badge">
                              {extName(job.inputPath).toUpperCase()} → {job.outputFormat.toUpperCase()}
                            </span>
                            <span className={`status-badge status-${job.status}`}>
                              {job.status === 'pendente' ? t.pending : job.status === 'processando' ? `${job.progress}%` : job.status === 'concluido' ? t.completed : t.error}
                            </span>
                            {job.status === 'concluido' && job.outputSize > 0 ? (
                              <span className="job-meta">
                                {formatBytes(job.inputSize)} → {formatBytes(job.outputSize)}
                                {job.inputSize > 0 && (
                                  <span className="green"> −{Math.round((1 - job.outputSize / job.inputSize) * 100)}%</span>
                                )}
                              </span>
                            ) : (
                              <span className="job-meta">{job.inputSize > 0 ? formatBytes(job.inputSize) : ''}</span>
                            )}
                            {job.status === 'pendente' && !audioRunning && (
                              <button className="remove-btn" onClick={() => handleRemoveAudioJob(job.id)} title={t.remove}>✕</button>
                            )}
                          </div>
                          {(job.status === 'processando' || job.status === 'concluido') && (
                            <div className="progress-track">
                              <div className={`progress-fill ${job.status === 'concluido' ? 'done' : ''}`} style={{ width: `${job.progress}%` }} />
                            </div>
                          )}
                          {job.status === 'erro' && job.errorMessage && (
                            <div className="job-error">{job.errorMessage}</div>
                          )}
                        </div>
                      )}
                    </SortableJobWrapper>
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>

      <div className="footer">
        <div className="summary">
          {audioTotals.done > 0 && (
            <>
              <strong>{audioTotals.done}</strong> {t.completedCount}
              {audioTotals.totalIn > 0 && (
                <>
                  {' '}· {formatBytes(audioTotals.totalIn)} → {formatBytes(audioTotals.totalOut)}
                  {' '}· <strong className="green">−{audioTotals.pct}%</strong>
                </>
              )}
            </>
          )}
        </div>
        <div className="row">
          {audioTotals.done > 0 && audioOutputDir && (
            <button className="btn btn-with-icon" onClick={handleOpenAudioOutput}>
              <IconExternalLink /> {t.openFolder}
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={handleCompressAudio}
            disabled={!hasPendingAudio || audioRunning}
          >
            {audioSubMode === 'compress' ? t.compressAudio : t.extractAudio} {audioJobs.filter((j) => j.status === 'pendente').length || ''}
          </button>
        </div>
      </div>
    </>
  );
}

function SettingsView({
  outputSettings, onChangeOutput, notificationsEnabled, onToggleNotifications,
  parallelCount, onChangeParallel, onBack, lang, changeLang, theme, onChangeTheme,
  ecoMode, onToggleEco, systemInfo,
}: {
  outputSettings: OutputSettings;
  onChangeOutput: (s: OutputSettings) => void;
  notificationsEnabled: boolean;
  onToggleNotifications: (v: boolean) => void;
  parallelCount: number;
  onChangeParallel: (n: number) => void;
  onBack: () => void;
  lang: Lang;
  changeLang: (l: Lang) => void;
  theme: 'dark' | 'light';
  onChangeTheme: (t: 'dark' | 'light') => void;
  ecoMode: boolean;
  onToggleEco: (v: boolean) => void;
  systemInfo: { cpuCores: number; totalRamMb: number; isLowEnd: boolean; recommendedParallel: number; recommendedThreads: number } | null;
}) {
  const { t } = useT();

  const handleSelectFixed = async () => {
    const folder = await pickFolder();
    if (folder) onChangeOutput({ mode: 'fixed', fixedPath: folder });
  };

  return (
    <>
      <div className="header">
        <div className="header-row">
          <button className="btn-back" onClick={onBack}>
            <IconBack /> {t.back}
          </button>
          <h1>{t.settings}</h1>
          <div style={{ width: 80 }} />
        </div>
      </div>
      <div className="content">
        {/* Aparência */}
        <div className="section">
          <div className="section-label">{lang === 'pt' ? 'Aparência' : 'Appearance'}</div>
          <div className="settings-grid-2">
            <div className="settings-card">
              <strong>{t.languageLabel}</strong>
              <div className="pill-row" style={{ marginTop: 10 }}>
                <Pill active={lang === 'pt'} onClick={() => changeLang('pt')}>Português</Pill>
                <Pill active={lang === 'en'} onClick={() => changeLang('en')}>English</Pill>
              </div>
            </div>
            <div className="settings-card">
              <strong>{t.theme}</strong>
              <div className="pill-row" style={{ marginTop: 10 }}>
                <Pill active={theme === 'dark'} onClick={() => onChangeTheme('dark')}>{t.themeDark}</Pill>
                <Pill active={theme === 'light'} onClick={() => onChangeTheme('light')}>{t.themeLight}</Pill>
              </div>
            </div>
          </div>
        </div>

        {/* Pasta de destino */}
        <div className="section">
          <div className="section-label">{t.defaultOutputFolder}</div>
          <div className="settings-options">
            <label className={`settings-option ${outputSettings.mode === 'same-folder' ? 'active' : ''}`}>
              <input type="radio" name="output-mode" checked={outputSettings.mode === 'same-folder'} onChange={() => onChangeOutput({ ...outputSettings, mode: 'same-folder' })} />
              <div>
                <strong>{t.sameFolder}</strong>
                <span className="hint">{t.sameFolderHint}</span>
              </div>
            </label>
            <label className={`settings-option ${outputSettings.mode === 'always-ask' ? 'active' : ''}`}>
              <input type="radio" name="output-mode" checked={outputSettings.mode === 'always-ask'} onChange={() => onChangeOutput({ ...outputSettings, mode: 'always-ask' })} />
              <div>
                <strong>{t.alwaysAsk}</strong>
                <span className="hint">{t.alwaysAskHint}</span>
              </div>
            </label>
            <label className={`settings-option ${outputSettings.mode === 'fixed' ? 'active' : ''}`}>
              <input type="radio" name="output-mode" checked={outputSettings.mode === 'fixed'} onChange={() => onChangeOutput({ ...outputSettings, mode: 'fixed' })} />
              <div>
                <strong>{t.fixedFolder}</strong>
                <span className="hint">{t.fixedFolderHint}</span>
              </div>
            </label>
          </div>
          {outputSettings.mode === 'fixed' && (
            <div className="settings-fixed-row">
              <span className="hint">{outputSettings.fixedPath || t.noFolderSelected}</span>
              <button className="btn btn-sm" onClick={handleSelectFixed}>{t.selectFolderBtn}</button>
            </div>
          )}
        </div>

        {/* Performance */}
        <div className="section">
          <div className="section-label">{t.performance}</div>
          <div className="settings-grid-2">
            <label className="settings-card toggle-card">
              <div style={{ flex: 1 }}>
                <strong>{t.ecoMode}</strong>
                <span className="hint">{t.ecoModeLabel}</span>
                {systemInfo && (
                  <span className="hint" style={{ marginTop: 4, display: 'block', fontSize: 11 }}>
                    {systemInfo.cpuCores} {t.cpuCores} · {Math.round(systemInfo.totalRamMb / 1024)}GB {t.ram}
                    {systemInfo.isLowEnd && <> · <span style={{ color: 'var(--amber)' }}>⚠</span></>}
                  </span>
                )}
              </div>
              <input type="checkbox" className="toggle" checked={ecoMode} onChange={(e) => onToggleEco(e.target.checked)} />
            </label>
            <div className="settings-card">
              <strong>{t.parallelCompression}</strong>
              <div className="pill-row" style={{ marginTop: 10 }}>
                {[1, 2, 3, 4].map((n) => (
                  <Pill key={n} active={parallelCount === n} onClick={() => onChangeParallel(n)}>{n}x</Pill>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Notificações */}
        <div className="section">
          <div className="section-label">{t.notifications}</div>
          <label className="toggle-row">
            <div>
              <strong>{t.notifyOnComplete}</strong>
              <span className="hint">{t.notifyHint}</span>
            </div>
            <input type="checkbox" className="toggle" checked={notificationsEnabled} onChange={(e) => onToggleNotifications(e.target.checked)} />
          </label>
        </div>
      </div>
    </>
  );
}

function HistoryView({ onBack }: { onBack: () => void }) {
  const { t, lang } = useT();
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);

  const totalSaved = useMemo(() => {
    return history.reduce((s, h) => s + (h.inputSize - h.outputSize), 0);
  }, [history]);

  const handleClear = () => {
    saveHistory([]);
    setHistory([]);
  };

  return (
    <>
      <div className="header">
        <div className="header-row">
          <button className="btn-back" onClick={onBack}>
            <IconBack /> {t.back}
          </button>
          <h1>{t.history}</h1>
          <div style={{ width: 80 }}>
            {history.length > 0 && (
              <button className="btn btn-sm" onClick={handleClear}>{t.clear}</button>
            )}
          </div>
        </div>
      </div>
      <div className="content">
        {history.length === 0 ? (
          <div className="empty">{t.emptyHistory}</div>
        ) : (
          <>
            <div className="history-summary">
              <strong>{history.length}</strong> {t.videosCompressedCount} · <strong className="green">{formatBytes(totalSaved)}</strong> {t.saved}
            </div>
            <div className="queue">
              {history.map((h, i) => (
                <div className="job" key={i}>
                  <div className="job-top">
                    <span className="job-name" title={h.fileName}>{h.fileName}</span>
                    <span className="job-meta">
                      {formatBytes(h.inputSize)} → {formatBytes(h.outputSize)}
                      <span className="green"> −{h.reduction}%</span>
                    </span>
                  </div>
                  <div className="hint" style={{ marginTop: 4 }}>
                    {new Date(h.date).toLocaleDateString(lang === 'pt' ? 'pt-BR' : 'en-US', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function StatsView({ onBack }: { onBack: () => void }) {
  const { t, lang } = useT();
  const history = useMemo(() => loadHistory(), []);

  const stats = useMemo(() => {
    const totalFiles = history.length;
    const totalOriginal = history.reduce((s, h) => s + h.inputSize, 0);
    const totalCompressed = history.reduce((s, h) => s + h.outputSize, 0);
    const totalSaved = totalOriginal - totalCompressed;
    const avgReduction = totalFiles > 0
      ? Math.round(history.reduce((s, h) => s + h.reduction, 0) / totalFiles)
      : 0;
    return { totalFiles, totalOriginal, totalCompressed, totalSaved, avgReduction };
  }, [history]);

  const chartData = useMemo(() => {
    const days: Record<string, number> = {};
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days[key] = 0;
    }
    for (const h of history) {
      const key = h.date.slice(0, 10);
      if (key in days) {
        days[key]++;
      }
    }
    const maxCount = Math.max(...Object.values(days), 1);
    return Object.entries(days).map(([date, count]) => ({
      label: new Date(date + 'T12:00:00').toLocaleDateString(lang === 'pt' ? 'pt-BR' : 'en-US', { day: '2-digit', month: '2-digit' }),
      count,
      pct: (count / maxCount) * 100,
    }));
  }, [history, lang]);

  return (
    <>
      <div className="header">
        <div className="header-row">
          <button className="btn-back" onClick={onBack}>
            <IconBack /> {t.back}
          </button>
          <h1>{t.stats}</h1>
          <div style={{ width: 80 }} />
        </div>
      </div>
      <div className="content">
        {history.length === 0 ? (
          <div className="empty">{t.noStatsYet}</div>
        ) : (
          <>
            <div className="stats-cards">
              <div className="stat-card">
                <div className="stat-card-value">{stats.totalFiles}</div>
                <div className="stat-card-label">{t.totalFilesCompressed}</div>
              </div>
              <div className="stat-card">
                <div className="stat-card-value green">{formatBytes(stats.totalSaved)}</div>
                <div className="stat-card-label">{t.totalSpaceSaved}</div>
              </div>
              <div className="stat-card">
                <div className="stat-card-value green">{stats.avgReduction}%</div>
                <div className="stat-card-label">{t.avgReduction}</div>
              </div>
              <div className="stat-card">
                <div className="stat-card-value" style={{ fontSize: 18 }}>
                  {formatBytes(stats.totalOriginal)} → {formatBytes(stats.totalCompressed)}
                </div>
                <div className="stat-card-label">{t.totalOriginalSize} → {t.totalCompressedSize}</div>
              </div>
            </div>
            <div className="stats-chart">
              <div className="stats-chart-title">{t.last30Days.split(' ')[0]} 7 {lang === 'pt' ? 'dias' : 'days'}</div>
              <div className="chart-bars">
                {chartData.map((d, i) => (
                  <div className="chart-bar-wrapper" key={i}>
                    <span className="chart-bar-count">{d.count > 0 ? d.count : ''}</span>
                    <div className="chart-bar" style={{ height: `${Math.max(d.pct, 2)}%` }} />
                    <span className="chart-bar-label">{d.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

type ConvertJobStatus = 'pendente' | 'convertendo' | 'convertido' | 'erro';

interface ConvertJobItem {
  id: string;
  inputPath: string;
  fileName: string;
  outputPath: string;
  inputSize: number;
  outputSize: number;
  outputFormat: string;
  status: ConvertJobStatus;
  progress: number;
  errorMessage?: string;
}

const ALL_VIDEO_FORMATS = ['mp4', 'mkv', 'webm', 'mov', 'avi', 'wmv', 'flv', 'm4v', 'ts'];
const ALL_IMAGE_FORMATS = ['jpg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'avif', 'ico'];
const ALL_AUDIO_FORMATS = ['mp3', 'aac', 'ogg', 'flac', 'wav', 'm4a', 'wma', 'opus'];

function detectFileType(ext: string): 'video' | 'image' | 'audio' | 'unknown' {
  if (VIDEO_EXTS.includes(ext)) return 'video';
  if (IMAGE_EXTS.includes(ext)) return 'image';
  if (AUDIO_EXTS.includes(ext)) return 'audio';
  return 'unknown';
}

function getFormatsForType(type: 'video' | 'image' | 'audio' | 'unknown'): string[] {
  if (type === 'video') return ALL_VIDEO_FORMATS;
  if (type === 'image') return ALL_IMAGE_FORMATS;
  if (type === 'audio') return ALL_AUDIO_FORMATS;
  return [...ALL_VIDEO_FORMATS, ...ALL_IMAGE_FORMATS, ...ALL_AUDIO_FORMATS];
}

async function pickConvertFiles(): Promise<string[]> {
  const result = await open({
    multiple: true,
    filters: [{
      name: 'All supported',
      extensions: [...VIDEO_EXTS, ...IMAGE_EXTS, ...AUDIO_EXTS],
    }],
  });
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

function FormatConverter({
  isDragging,
  outputSettings,
  notifyUser,
}: {
  isDragging: boolean;
  outputSettings: OutputSettings;
  notifyUser: (title: string, body: string) => Promise<void>;
}) {
  const { t, lang } = useT();
  const [convertJobs, setConvertJobs] = useState<ConvertJobItem[]>([]);
  const [convertOutputDir, setConvertOutputDir] = useState('');
  const [outputFormat, setOutputFormat] = useState('mp4');
  const [convertRunning, setConvertRunning] = useState(false);

  const detectedType = useMemo((): 'video' | 'image' | 'audio' | 'unknown' => {
    if (convertJobs.length === 0) return 'unknown';
    const ext = extName(convertJobs[0].inputPath).toLowerCase();
    return detectFileType(ext);
  }, [convertJobs]);

  const availableFormats = useMemo(() => getFormatsForType(detectedType), [detectedType]);

  // Atualizar formato padrão ao mudar tipo detectado
  useEffect(() => {
    if (availableFormats.length > 0 && !availableFormats.includes(outputFormat)) {
      setOutputFormat(availableFormats[0]);
    }
  }, [availableFormats]);

  const resolveConvertOutputDir = useCallback(async (sourcePath: string): Promise<string | null> => {
    if (outputSettings.mode === 'fixed' && outputSettings.fixedPath) return outputSettings.fixedPath;
    if (outputSettings.mode === 'always-ask') return joinPath(dirName(sourcePath), 'comprimidos');
    return joinPath(dirName(sourcePath), 'convertidos');
  }, [outputSettings]);

  const addConvertJobs = useCallback(async (paths: string[], outDir: string) => {
    const newJobs: ConvertJobItem[] = [];
    for (const p of paths) {
      const fileName = baseName(p);
      const size = await invoke<number>('get_file_size', { filePath: p });
      const outFileName = changeExt(fileName, outputFormat);
      newJobs.push({
        id: nextId(),
        inputPath: p,
        fileName,
        outputPath: joinPath(outDir, outFileName),
        inputSize: size,
        outputSize: 0,
        outputFormat,
        status: 'pendente',
        progress: 0,
      });
    }
    setConvertJobs((prev) => {
      const existingPaths = new Set(prev.map(j => j.inputPath));
      const unique = newJobs.filter(j => !existingPaths.has(j.inputPath));
      return [...prev, ...unique];
    });
  }, [outputFormat]);

  const handleSelectFiles = useCallback(async () => {
    const files = await pickConvertFiles();
    if (files.length === 0) return;
    const outDir = await resolveConvertOutputDir(files[0]);
    if (!outDir) return;
    setConvertOutputDir(outDir);
    await addConvertJobs(files, outDir);
  }, [addConvertJobs, resolveConvertOutputDir]);

  // Drag & drop
  useEffect(() => {
    const unlisten = listen<{ paths: string[] }>('tauri://drag-drop', async (event) => {
      const paths = event.payload.paths || [];
      const allExts = [...VIDEO_EXTS, ...IMAGE_EXTS, ...AUDIO_EXTS];
      const validPaths = paths.filter((p) => allExts.includes(extName(p)));
      if (validPaths.length === 0) return;
      const outDir = await resolveConvertOutputDir(validPaths[0]);
      if (!outDir) return;
      setConvertOutputDir(outDir);
      await addConvertJobs(validPaths, outDir);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [addConvertJobs, resolveConvertOutputDir]);

  // Eventos de conclusão/erro
  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    listen<{ jobId: string; progress: number }>('convert-progress', (event) => {
      const { jobId, progress } = event.payload;
      setConvertJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, progress } : j
        )
      );
    }).then((fn) => unlisteners.push(fn));

    listen<{ jobId: string; outputSize: number }>('convert-done', (event) => {
      const { jobId, outputSize } = event.payload;
      setConvertJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, status: 'convertido' as ConvertJobStatus, outputSize, progress: 100 } : j
        )
      );
    }).then((fn) => unlisteners.push(fn));

    listen<{ jobId: string; message: string }>('convert-error', (event) => {
      const { jobId, message } = event.payload;
      setConvertJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, status: 'erro' as ConvertJobStatus, errorMessage: message } : j
        )
      );
    }).then((fn) => unlisteners.push(fn));

    return () => { unlisteners.forEach((fn) => fn()); };
  }, []);

  // Notificar ao concluir
  useEffect(() => {
    if (!convertRunning) return;
    const allDone = convertJobs.every((j) => j.status === 'convertido' || j.status === 'erro');
    if (convertJobs.length > 0 && allDone) {
      setConvertRunning(false);
      const done = convertJobs.filter((j) => j.status === 'convertido').length;
      const errors = convertJobs.filter((j) => j.status === 'erro').length;
      const body = errors > 0
        ? `${done} ${t.converted}, ${errors} ${t.error}`
        : `${done} ${t.converted}`;
      notifyUser(t.convertFiles, body);
      invoke('play_completion_sound').catch(() => {});
    }
  }, [convertJobs, convertRunning, t, notifyUser]);

  const handleConvert = useCallback(async () => {
    const pending = convertJobs.filter((j) => j.status === 'pendente');
    if (pending.length === 0) return;
    setConvertRunning(true);
    // Atualizar status para "convertendo"
    setConvertJobs((prev) =>
      prev.map((j) => j.status === 'pendente' ? { ...j, status: 'convertendo' as ConvertJobStatus } : j)
    );
    const jobsToSend = pending.map((j) => ({
      id: j.id,
      inputPath: j.inputPath,
      fileName: j.fileName,
      outputPath: joinPath(convertOutputDir, changeExt(j.fileName, outputFormat)),
      inputSize: j.inputSize,
      outputFormat,
    }));
    await invoke('convert_files', { jobs: jobsToSend });
  }, [convertJobs, convertOutputDir, outputFormat]);

  const handleRemoveConvert = useCallback((id: string) => {
    setConvertJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const convertSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEndConvert = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setConvertJobs((prev) => {
        const oldIdx = prev.findIndex((j) => j.id === active.id);
        const newIdx = prev.findIndex((j) => j.id === over.id);
        return arrayMove(prev, oldIdx, newIdx);
      });
    }
  }, []);

  const handleClearConvert = useCallback(() => {
    if (!confirm(t.confirmClear)) return;
    setConvertJobs([]);
    setConvertOutputDir('');
  }, [t]);

  const handleOpenConvertOutput = useCallback(async () => {
    if (convertOutputDir) await invoke('open_folder', { folderPath: convertOutputDir });
  }, [convertOutputDir]);

  const convertTotals = useMemo(() => {
    const done = convertJobs.filter((j) => j.status === 'convertido');
    const totalIn = done.reduce((s, j) => s + j.inputSize, 0);
    const totalOut = done.reduce((s, j) => s + j.outputSize, 0);
    return { totalIn, totalOut, done: done.length };
  }, [convertJobs]);

  const hasPendingConvert = convertJobs.some((j) => j.status === 'pendente');

  return (
    <>
      {isDragging && (
        <div className="drop-overlay">
          <div className="drop-content">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>{t.dropHere}</span>
          </div>
        </div>
      )}

      <div className="content">
        <div className="section">
          <div className="section-label">{t.selectFilesToConvert}</div>
          <div className="row">
            <button className="btn btn-with-icon" onClick={handleSelectFiles} disabled={convertRunning}>
              <IconConvert /> {t.selectFilesToConvert}
            </button>
            {convertJobs.length > 0 && !convertRunning && (
              <button className="btn" onClick={handleClearConvert}>
                {t.clearList}
              </button>
            )}
          </div>
          <div className="hint" style={{ marginTop: 6 }}>{t.dragHint}</div>
          {convertOutputDir && (
            <div className="hint output-dir-row">
              {t.savingTo} <strong>{convertOutputDir}</strong>
            </div>
          )}
        </div>

        <div className="section">
          <div className="section-label">{t.convertTo}</div>
          <div className="options">
            <div className="option-group">
              <div className="pill-row">
                {availableFormats.map((fmt) => (
                  <Pill key={fmt} active={outputFormat === fmt} onClick={() => setOutputFormat(fmt)}>
                    .{fmt.toUpperCase()}
                  </Pill>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="section">
          <div className="section-label">{t.queue} ({convertJobs.length})</div>
          {convertJobs.length === 0 ? (
            <div className="empty">{t.emptyConvertQueue}</div>
          ) : (
            <DndContext sensors={convertSensors} collisionDetection={closestCenter} onDragEnd={handleDragEndConvert}>
              <SortableContext items={convertJobs.map(j => j.id)} strategy={verticalListSortingStrategy}>
                <div className="queue">
                  {convertJobs.map((job) => (
                    <SortableJobWrapper key={job.id} id={job.id} canDrag={job.status === 'pendente' && !convertRunning}>
                      {(dragHandle) => (
                        <div className="job">
                          <div className="job-top">
                            {dragHandle}
                            <span className="job-name" title={job.fileName}>{job.fileName}</span>
                            <span className="format-badge">
                              {extName(job.inputPath).toUpperCase()} → {outputFormat.toUpperCase()}
                            </span>
                            <span className={`status-badge status-${job.status === 'convertendo' ? 'processando' : job.status === 'convertido' ? 'concluido' : job.status}`}>
                              {job.status === 'pendente' ? t.pending
                                : job.status === 'convertendo' ? (job.progress > 0 ? `${job.progress}%` : t.converting)
                                : job.status === 'convertido' ? t.converted
                                : t.error}
                            </span>
                            {job.status === 'convertido' && job.outputSize > 0 ? (
                              <span className="job-meta">
                                {formatBytes(job.inputSize)} → {formatBytes(job.outputSize)}
                              </span>
                            ) : (
                              <span className="job-meta">{job.inputSize > 0 ? formatBytes(job.inputSize) : ''}</span>
                            )}
                            {job.status === 'pendente' && !convertRunning && (
                              <button className="remove-btn" onClick={() => handleRemoveConvert(job.id)} title={t.remove}>✕</button>
                            )}
                          </div>
                          {job.status === 'erro' && job.errorMessage && (
                            <div className="job-error">{job.errorMessage}</div>
                          )}
                        </div>
                      )}
                    </SortableJobWrapper>
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>

      <div className="footer">
        <div className="summary">
          {convertTotals.done > 0 && (
            <>
              <strong>{convertTotals.done}</strong> {t.converted}
              {convertTotals.totalIn > 0 && (
                <>
                  {' '}· {formatBytes(convertTotals.totalIn)} → {formatBytes(convertTotals.totalOut)}
                </>
              )}
            </>
          )}
        </div>
        <div className="row">
          {convertTotals.done > 0 && convertOutputDir && (
            <button className="btn btn-with-icon" onClick={handleOpenConvertOutput}>
              <IconExternalLink /> {t.openFolder}
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={handleConvert}
            disabled={!hasPendingConvert || convertRunning}
          >
            {t.convertFiles} {convertJobs.filter((j) => j.status === 'pendente').length || ''}
          </button>
        </div>
      </div>
    </>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={`pill ${active ? 'active' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

function SortableJobWrapper({ id, canDrag, children }: { id: string; canDrag: boolean; children: (dragHandle: React.ReactNode) => React.ReactNode }) {
  const { t } = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !canDrag });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  const handle = canDrag ? (
    <button className="drag-handle" {...attributes} {...listeners} title={t.dragReorder}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
        <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
        <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
      </svg>
    </button>
  ) : null;
  return <div ref={setNodeRef} style={style}>{children(handle)}</div>;
}

function SortableJobRow({ job, onRemove, running }: {
  job: VideoJob;
  onRemove: (id: string) => void;
  running: boolean;
}) {
  const { t, lang } = useT();
  const canDrag = job.status === 'pendente' && !running;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: job.id, disabled: !canDrag });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  const reduction =
    job.inputSize > 0 && job.outputSize > 0
      ? Math.round((1 - job.outputSize / job.inputSize) * 100)
      : null;

  let eta = '';
  if (job.status === 'processando' && job.startedAt && job.progress > 2) {
    const elapsed = (Date.now() - job.startedAt) / 1000;
    const remaining = (elapsed / job.progress) * (100 - job.progress);
    eta = formatEta(remaining, lang);
  }

  return (
    <div className="job" ref={setNodeRef} style={style}>
      <div className="job-top">
        {canDrag && (
          <button className="drag-handle" {...attributes} {...listeners} title={t.dragReorder}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="9" cy="6" r="1.5" />
              <circle cx="15" cy="6" r="1.5" />
              <circle cx="9" cy="12" r="1.5" />
              <circle cx="15" cy="12" r="1.5" />
              <circle cx="9" cy="18" r="1.5" />
              <circle cx="15" cy="18" r="1.5" />
            </svg>
          </button>
        )}
        {job.thumbnail && (
          <img className="job-thumb" src={job.thumbnail} alt="" />
        )}
        <span className="job-name" title={job.fileName}>{job.fileName}</span>
        <span className="format-badge">{job.inputFormat} → {job.outputPath.split('.').pop()?.toUpperCase()}</span>
        <span className={`status-badge status-${job.status}`}>
          {job.status === 'processando' ? `${job.progress}%` : statusText(job.status, t)}
        </span>
        {job.status === 'concluido' && job.outputSize > 0 ? (
          <span className="job-meta">
            {formatBytes(job.inputSize)} → {formatBytes(job.outputSize)}
            {reduction !== null && <span className="green"> −{reduction}%</span>}
          </span>
        ) : (
          <span className="job-meta">{job.inputSize > 0 ? formatBytes(job.inputSize) : ''}</span>
        )}
        {canDrag && (
          <button className="remove-btn" onClick={() => onRemove(job.id)} title={t.remove}>✕</button>
        )}
      </div>
      {(job.status === 'processando' || job.status === 'concluido') && (
        <div className="progress-track">
          <div className={`progress-fill ${job.status === 'concluido' ? 'done' : ''}`} style={{ width: `${job.progress}%` }} />
        </div>
      )}
      {job.status === 'erro' && job.errorMessage && (
        <div className="job-error">⚠ {job.errorMessage}</div>
      )}
    </div>
  );
}
