import { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  VideoJob,
  CompressionSettings,
  VideoFormat,
  Quality,
  Resolution,
} from '../shared/types';

type OutputMode = 'same-folder' | 'always-ask' | 'fixed';

interface OutputSettings {
  mode: OutputMode;
  fixedPath: string;
}

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
  const [showSettings, setShowSettings] = useState(false);
  const [outputSettings, setOutputSettingsState] = useState<OutputSettings>(loadOutputSettings);

  const [format, setFormat] = useState<VideoFormat>('h264');
  const [quality, setQuality] = useState<Quality>('media');
  const [resolution, setResolution] = useState<Resolution>('original');

  const updateOutputSettings = useCallback((s: OutputSettings) => {
    setOutputSettingsState(s);
    saveOutputSettings(s);
  }, []);

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

  useEffect(() => {
    if (!running) return;
    const allDone = jobs.every(
      (j) => j.status === 'concluido' || j.status === 'erro'
    );
    if (jobs.length > 0 && allDone) {
      setRunning(false);
    }
  }, [jobs, running]);

  const resolveOutputDir = useCallback(async (sourcePath: string): Promise<string | null> => {
    if (outputSettings.mode === 'fixed' && outputSettings.fixedPath) {
      return outputSettings.fixedPath;
    }
    if (outputSettings.mode === 'always-ask') {
      const folder = await window.electronAPI.selectFolder();
      return folder;
    }
    // same-folder: cria subpasta /comprimidos
    return joinPath(dirName(sourcePath), 'comprimidos');
  }, [outputSettings]);

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
    const outDir = await resolveOutputDir(videos[0].path);
    if (!outDir) return;
    setOutputDir(outDir);
    await addJobsFromPaths(videos, outDir);
  }, [addJobsFromPaths, resolveOutputDir]);

  const handleSelectFiles = useCallback(async () => {
    const files = await window.electronAPI.selectFiles();
    if (files.length === 0) return;
    const outDir = await resolveOutputDir(files[0]);
    if (!outDir) return;
    setOutputDir(outDir);
    const items = files.map((f) => ({ path: f, size: 0 }));
    await addJobsFromPaths(items, outDir);
  }, [addJobsFromPaths, resolveOutputDir]);

  const handleChangeOutputDir = useCallback(async () => {
    const folder = await window.electronAPI.selectFolder();
    if (!folder) return;
    setOutputDir(folder);
    setJobs((prev) =>
      prev.map((j) => ({
        ...j,
        outputPath: joinPath(folder, j.fileName),
      }))
    );
  }, []);

  const handleStart = useCallback(async () => {
    const pending = jobs.filter((j) => j.status === 'pendente');
    if (pending.length === 0) return;
    setRunning(true);
    const settings: CompressionSettings = { format, quality, resolution };
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
    const done = jobs.filter((j) => j.status === 'concluido');
    const totalIn = done.reduce((s, j) => s + j.inputSize, 0);
    const totalOut = done.reduce((s, j) => s + j.outputSize, 0);
    const pct = totalIn > 0 ? Math.round((1 - totalOut / totalIn) * 100) : 0;
    return { totalIn, totalOut, done: done.length, pct };
  }, [jobs]);

  const hasPending = jobs.some((j) => j.status === 'pendente');

  return (
    <div className="app">
      <div className="header">
        <div className="header-row">
          <div>
            <h1>Video Compressor</h1>
            <p>Comprime seus vídeos mantendo qualidade — pronto para hospedar online.</p>
          </div>
          <button
            className="btn btn-icon"
            onClick={() => setShowSettings(!showSettings)}
            title="Configurações"
          >
            ⚙
          </button>
        </div>
      </div>

      {showSettings && (
        <SettingsPanel
          settings={outputSettings}
          onChange={updateOutputSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

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
            <div className="hint output-dir-row">
              Salvando em: <strong>{outputDir}</strong>
              {!running && (
                <button className="btn btn-sm" onClick={handleChangeOutputDir}>
                  Alterar
                </button>
              )}
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
              <strong>{totals.done}</strong> concluído(s)
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

      <div className="credits">
        Feito por <strong>Danillo Muniz</strong> · danillo@ae.digital
      </div>
    </div>
  );
}

function SettingsPanel({
  settings,
  onChange,
  onClose,
}: {
  settings: OutputSettings;
  onChange: (s: OutputSettings) => void;
  onClose: () => void;
}) {
  const handleSelectFixed = async () => {
    const folder = await window.electronAPI.selectFolder();
    if (folder) {
      onChange({ mode: 'fixed', fixedPath: folder });
    }
  };

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <span className="section-label" style={{ margin: 0 }}>Configurações</span>
        <button className="remove-btn" onClick={onClose}>✕</button>
      </div>
      <div className="settings-body">
        <div className="section-label">Pasta de destino padrão</div>
        <div className="settings-options">
          <label className={`settings-option ${settings.mode === 'same-folder' ? 'active' : ''}`}>
            <input
              type="radio"
              name="output-mode"
              checked={settings.mode === 'same-folder'}
              onChange={() => onChange({ ...settings, mode: 'same-folder' })}
            />
            <div>
              <strong>Mesma pasta dos vídeos</strong>
              <span className="hint">Cria subpasta /comprimidos ao lado dos originais</span>
            </div>
          </label>
          <label className={`settings-option ${settings.mode === 'always-ask' ? 'active' : ''}`}>
            <input
              type="radio"
              name="output-mode"
              checked={settings.mode === 'always-ask'}
              onChange={() => onChange({ ...settings, mode: 'always-ask' })}
            />
            <div>
              <strong>Sempre perguntar</strong>
              <span className="hint">Abre seletor de pasta toda vez</span>
            </div>
          </label>
          <label className={`settings-option ${settings.mode === 'fixed' ? 'active' : ''}`}>
            <input
              type="radio"
              name="output-mode"
              checked={settings.mode === 'fixed'}
              onChange={() => onChange({ ...settings, mode: 'fixed' })}
            />
            <div>
              <strong>Pasta fixa</strong>
              <span className="hint">Sempre salva no mesmo lugar</span>
            </div>
          </label>
        </div>
        {settings.mode === 'fixed' && (
          <div className="settings-fixed-row">
            <span className="hint">
              {settings.fixedPath || 'Nenhuma pasta selecionada'}
            </span>
            <button className="btn btn-sm" onClick={handleSelectFixed}>
              Selecionar pasta
            </button>
          </div>
        )}
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
        {job.status === 'concluido' && job.outputSize > 0 ? (
          <span className="job-meta">
            {formatBytes(job.inputSize)} → {formatBytes(job.outputSize)}
            {reduction !== null && (
              <span className="green"> −{reduction}%</span>
            )}
          </span>
        ) : (
          <span className="job-meta">
            {job.inputSize > 0 ? formatBytes(job.inputSize) : ''}
          </span>
        )}
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
