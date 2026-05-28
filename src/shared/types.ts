// Tipos compartilhados entre o processo main (Electron) e o renderer (React)

export type VideoFormat = 'h264' | 'h265';
export type Quality = 'alta' | 'media' | 'baixa';
export type Resolution = 'original' | '1080p' | '720p';

export interface CompressionSettings {
  format: VideoFormat;
  quality: Quality;
  resolution: Resolution;
}

export type JobStatus = 'pendente' | 'processando' | 'concluido' | 'erro';

export interface VideoJob {
  id: string;
  inputPath: string;
  fileName: string;
  outputPath: string;
  status: JobStatus;
  progress: number; // 0-100
  inputSize: number; // bytes
  outputSize: number; // bytes (preenchido ao concluir)
  durationSeconds: number; // duração total do vídeo, p/ calcular progresso
  errorMessage?: string;
}

// Eventos enviados do main para o renderer
export interface ProgressEvent {
  jobId: string;
  progress: number;
}

export interface JobDoneEvent {
  jobId: string;
  outputSize: number;
}

export interface JobErrorEvent {
  jobId: string;
  message: string;
}

// API exposta no window pelo preload
export interface ElectronAPI {
  selectFolder: () => Promise<string | null>;
  selectFiles: () => Promise<string[]>;
  scanFolder: (folderPath: string) => Promise<{ path: string; size: number }[]>;
  probeDuration: (filePath: string) => Promise<number>;
  startCompression: (
    jobs: VideoJob[],
    settings: CompressionSettings,
    outputDir: string
  ) => Promise<void>;
  cancelAll: () => Promise<void>;
  openFolder: (folderPath: string) => Promise<void>;
  onProgress: (cb: (e: ProgressEvent) => void) => void;
  onJobDone: (cb: (e: JobDoneEvent) => void) => void;
  onJobError: (cb: (e: JobErrorEvent) => void) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
