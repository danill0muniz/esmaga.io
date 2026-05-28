import { contextBridge, ipcRenderer } from 'electron';
import type {
  VideoJob,
  CompressionSettings,
  ProgressEvent,
  JobDoneEvent,
  JobErrorEvent,
} from '../shared/types';

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectFiles: () => ipcRenderer.invoke('select-files'),
  scanFolder: (folderPath: string) => ipcRenderer.invoke('scan-folder', folderPath),
  probeDuration: (filePath: string) => ipcRenderer.invoke('probe-duration', filePath),
  startCompression: (
    jobs: VideoJob[],
    settings: CompressionSettings,
    outputDir: string
  ) => ipcRenderer.invoke('start-compression', jobs, settings, outputDir),
  cancelAll: () => ipcRenderer.invoke('cancel-all'),
  openFolder: (folderPath: string) => ipcRenderer.invoke('open-folder', folderPath),
  onProgress: (cb: (e: ProgressEvent) => void) =>
    ipcRenderer.on('progress', (_evt, data) => cb(data)),
  onJobDone: (cb: (e: JobDoneEvent) => void) =>
    ipcRenderer.on('job-done', (_evt, data) => cb(data)),
  onJobError: (cb: (e: JobErrorEvent) => void) =>
    ipcRenderer.on('job-error', (_evt, data) => cb(data)),
});
