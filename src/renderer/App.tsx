import { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  VideoJob,
  CompressionSettings,
  VideoFormat,
  Quality,
  Resolution,
} from '../shared/types';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
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

export default function App() {
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [outputDir, setOutputDir] = useState<string>('');
  const [running, setRunning] = useState(false);

  const [format, setFormat] = useState<VideoFormat>('h264');
  const [quality, setQuality] = useState<Quality>('media');
  const [resolution, setResolution] = useState<Resolution>('original');

  // Listeners de eventos do main
  useEffect(() => {
    window.electronAPI.onProgress(({ jobId, progress }) => {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, status: 'processando', progress } : j
        )
      );
    });
    window.electronAPI.onJobDone(({ jobId, outputSize }) => {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? { ...j, status: 'concluido', progress: 100, outputSize }
            : j
        )
      );
    });
    window.electronAPI.onJobError(({ jobId, message }) => {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, status: 'erro', errorMessage: message } : j
        )
      );
    });
  }, []);

  // Detecta quando a fila terminou para liberar a UI
  useEffect(() => {
    if (!running) return;
    const allDone = jobs.every(
      (j) => j.status === 'concluido' || j.status === 'erro'
    );
    if (jobs.length > 0 && allDone) {
      setRunning(false);
    }
  }, [jobs, running]);

  const addJobsFromPaths = useCallback(
    async (items: { path: string; size: number }[], outDir: string) => {
      const newJobs: VideoJob[] = [];
      for (const item of items) {
        const fileName = baseName(item.path);
        const duration = await window.electronAPI.probeDuration(item.path);
        newJobs.push({
          id: nextId(),
          inputPath: item.path,
          fileName,
          outputPath: joinPath(outDir, fileName),
          status: 'pendente',
          progress: 0,
          inputSize: item.size,
          outputSize: 0,
          durationSeconds: duration,
        });
      }
      setJobs((prev) => [...prev, ...newJobs]);
    },
    []
  );

  const handleSelectFolder = useCallback(async () => {
    const folder = await window.electronAPI.selectFolder();
    if (!folder) return;
    const videos = await window.electronAPI.scanFolder(folder);
    if (videos.length === 0) {
      alert('Nenhum vídeo encontrado nessa pasta.');
      return;
    }
    const outDir = joinPath(folder, 'comprimidos');
    setOutputDir(outDir);
    await addJobsFromPaths(videos, outDir);
  }, [addJobsFromPaths]);

  const handleSelectFiles = useCallback(async () => {
    const files = await window.electronAPI.selectFiles();
    if (files.length === 0) return;
    // pasta de saída = pasta do primeiro arquivo + /comprimidos
    const outDir = joinPath(dirName(files[0]), 'comprimidos');
    setOutputDir(outDir);
    // precisamos do tamanho; scanFolder não serve p/ arquivos avulsos,
    // então marcamos size 0 e ele é só informativo até concluir
    const items = files.map((f) => ({ path: f, size: 0 }));
    await addJobsFromPaths(items, outDir);
  }, [addJobsFromPaths]);

  const handleStart = useCallback(async () => {
    const pending = jobs.filter((j) => j.status === 'pendente');
    if (pending.length === 0) return;
    setRunning(true);
    const settings: CompressionSettings = { format, quality, resolution };
    // recalcula outputPath conforme a pasta de saída atual
    const prepared = pending.map((j) => ({
      ...j,
      outputPath: joinPath(outputDir, j.fileName),
    }));
    await window.electronAPI.startCompression(prepared, settings, outputDir);
  }, [jobs, format, quality, resolution, outputDir]);

  const handleCancel = useCallback(async () => {
    await window.electronAPI.cancelAll();
    setRunning(false);
    setJobs((prev) =>
      prev.map((j) =>
        j.status === 'processando' || j.status === 'pendente'
          ? { ...j, status: 'pendente', progress: 0 }
          : j
      )
    );
  }, []);

  const handleRemove = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const handleClear = useCallback(() => {
    setJobs([]);
    setOutputDir('');
  }, []);

  const handleOpenOutput = useCallback(() => {
    if (outputDir) window.electronAPI.openFolder(outputDir);
  }, [outputDir]);

  const totals = useMemo(() => {
    const totalIn = jobs.reduce((s, j) => s + j.inputSize, 0);
    const totalOut = jobs.reduce((s, j) => s + j.outputSize, 0);
    const done = jobs.filter((j) => j.status === 'concluido').length;
    return { totalIn, totalOut, done };
  }, [jobs]);

  const hasPending = jobs.some((j) => j.status === 'pendente');

  return (
    <div className="app">
      <div className="header">
        <h1>Video Compressor</h1>
        <p>Comprime seus vídeos mantendo qualidade — pronto para hospedar online.</p>
      </div>

      <div className="content">
        <div className="section">
          <div className="section-label">1. Selecione os vídeos</div>
          <div className="row">
            <button className="btn" onClick={handleSelectFolder} disabled={running}>
              📁 Selecionar pasta
            </button>
            <button className="btn" onClick={handleSelectFiles} disabled={running}>
              🎬 Selecionar vídeo(s)
            </button>
            {jobs.length > 0 && !running && (
              <button className="btn" onClick={handleClear}>
                Limpar lista
              </button>
            )}
          </div>
          {outputDir && (
            <div className="hint">
              Os comprimidos vão para: <strong>{outputDir}</strong>
            </div>
          )}
        </div>

        <div className="section">
          <div className="section-label">2. Opções de compressão</div>
          <div className="options">
            <div className="option-group">
              <div className="section-label">Formato</div>
              <div className="pill-row">
                <Pill active={format === 'h264'} onClick={() => setFormat('h264')}>
                  MP4 · H.264
                </Pill>
                <Pill active={format === 'h265'} onClick={() => setFormat('h265')}>
                  MP4 · H.265
                </Pill>
              </div>
              <div className="hint">
                H.264 = compatível com tudo. H.265 = arquivos menores, ideal pra
                guardar.
              </div>
            </div>

            <div className="option-group">
              <div className="section-label">Qualidade</div>
              <div className="pill-row">
                <Pill active={quality === 'alta'} onClick={() => setQuality('alta')}>
                  Alta
                </Pill>
                <Pill active={quality === 'media'} onClick={() => setQuality('media')}>
                  Média
                </Pill>
                <Pill active={quality === 'baixa'} onClick={() => setQuality('baixa')}>
                  Baixa
                </Pill>
              </div>
              <div className="hint">Média é o melhor equilíbrio para fala.</div>
            </div>

            <div className="option-group">
              <div className="section-label">Resolução</div>
              <div className="pill-row">
                <Pill
                  active={resolution === 'original'}
                  onClick={() => setResolution('original')}
                >
                  Original
                </Pill>
                <Pill
                  active={resolution === '1080p'}
                  onClick={() => setResolution('1080p')}
                >
                  1080p
                </Pill>
                <Pill
                  active={resolution === '720p'}
                  onClick={() => setResolution('720p')}
                >
                  720p
                </Pill>
              </div>
              <div className="hint">
                1080p reduz muito o tamanho de gravações 4K sem perda perceptível em
                vídeo de fala.
              </div>
            </div>
          </div>
        </div>

        <div className="section">
          <div className="section-label">3. Fila ({jobs.length})</div>
          {jobs.length === 0 ? (
            <div className="empty">
              Nenhum vídeo na fila. Selecione uma pasta ou arquivos acima.
            </div>
          ) : (
            <div className="queue">
              {jobs.map((job) => (
                <JobRow key={job.id} job={job} onRemove={handleRemove} running={running} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="footer">
        <div className="summary">
          {totals.done > 0 && (
            <>
              <strong>{totals.done}</strong> concluído(s) ·{' '}
              {totals.totalIn > 0 && (
                <>
                  de <strong>{formatBytes(totals.totalIn)}</strong> para{' '}
                  <strong>{formatBytes(totals.totalOut)}</strong>
                </>
              )}
            </>
          )}
        </div>
        <div className="row">
          {totals.done > 0 && outputDir && (
            <button className="btn" onClick={handleOpenOutput}>
              Abrir pasta de saída
            </button>
          )}
          {running ? (
            <button className="btn btn-danger" onClick={handleCancel}>
              Cancelar
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={handleStart}
              disabled={!hasPending}
            >
              Comprimir {jobs.filter((j) => j.status === 'pendente').length || ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button className={`pill ${active ? 'active' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

function JobRow({
  job,
  onRemove,
  running,
}: {
  job: VideoJob;
  onRemove: (id: string) => void;
  running: boolean;
}) {
  const reduction =
    job.inputSize > 0 && job.outputSize > 0
      ? Math.round((1 - job.outputSize / job.inputSize) * 100)
      : null;

  return (
    <div className="job">
      <div className="job-top">
        <span className="job-name" title={job.fileName}>
          {job.fileName}
        </span>
        <span className={`status-badge status-${job.status}`}>{job.status}</span>
        <span className="job-meta">
          {job.status === 'concluido' && job.outputSize > 0
            ? `${formatBytes(job.outputSize)}${
                reduction !== null ? ` · −${reduction}%` : ''
              }`
            : job.inputSize > 0
            ? formatBytes(job.inputSize)
            : ''}
        </span>
        {job.status === 'pendente' && !running && (
          <button className="remove-btn" onClick={() => onRemove(job.id)} title="Remover">
            ✕
          </button>
        )}
      </div>
      {(job.status === 'processando' || job.status === 'concluido') && (
        <div className="progress-track">
          <div
            className={`progress-fill ${job.status === 'concluido' ? 'done' : ''}`}
            style={{ width: `${job.progress}%` }}
          />
        </div>
      )}
      {job.status === 'erro' && job.errorMessage && (
        <div className="job-error">⚠ {job.errorMessage}</div>
      )}
    </div>
  );
}
