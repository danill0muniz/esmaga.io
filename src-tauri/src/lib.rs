use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{
    AppHandle, Emitter, Manager,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

// ---------- Tipos ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoFile {
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoJob {
    pub id: String,
    pub input_path: String,
    pub file_name: String,
    pub output_path: String,
    pub status: String,
    pub progress: u32,
    pub input_size: u64,
    pub output_size: u64,
    pub duration_seconds: f64,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressionSettings {
    pub format: String,
    pub quality: String,
    pub resolution: String,
    pub container: String,
    pub remove_audio: bool,
    pub trim_start: Option<String>,
    pub trim_end: Option<String>,
    pub max_threads: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub job_id: String,
    pub progress: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobDoneEvent {
    pub job_id: String,
    pub output_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobErrorEvent {
    pub job_id: String,
    pub message: String,
}

// ---------- Dados do tray ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayJobInfo {
    pub file_name: String,
    pub status: String,
    pub progress: u32,
}

// ---------- Estado ----------

struct AppState {
    hw_encoders: Mutex<Vec<String>>,
    cancelled: Arc<Mutex<bool>>,
}

// ---------- Extensões de vídeo ----------

const VIDEO_EXTENSIONS: &[&str] = &[
    ".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".wmv", ".flv",
];

const IMAGE_EXTENSIONS: &[&str] = &[
    ".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".tif", ".gif",
];

const AUDIO_EXTENSIONS: &[&str] = &[
    ".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".wma",
];

// ---------- Tipos de imagem ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageJob {
    pub id: String,
    pub input_path: String,
    pub file_name: String,
    pub output_path: String,
    pub input_size: u64,
    pub output_format: String,
    pub quality: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageDoneEvent {
    pub job_id: String,
    pub output_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageErrorEvent {
    pub job_id: String,
    pub message: String,
}

// ---------- Tipos de áudio ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioJob {
    pub id: String,
    pub input_path: String,
    pub file_name: String,
    pub output_path: String,
    pub input_size: u64,
    pub output_format: String,
    pub bitrate: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractAudioJob {
    pub id: String,
    pub input_path: String,
    pub file_name: String,
    pub output_path: String,
    pub input_size: u64,
    pub output_format: String,
    pub bitrate: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDoneEvent {
    pub job_id: String,
    pub output_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioErrorEvent {
    pub job_id: String,
    pub message: String,
}

// ---------- Helpers ----------

fn quality_for_software(format: &str, quality: &str) -> u32 {
    if format == "h265" {
        match quality {
            "alta" => 24,
            "media" => 28,
            _ => 32,
        }
    } else {
        match quality {
            "alta" => 20,
            "media" => 23,
            _ => 28,
        }
    }
}

fn quality_for_hw(quality: &str) -> u32 {
    match quality {
        "alta" => 35,
        "media" => 50,
        _ => 65,
    }
}

fn get_hw_encoder(format: &str, encoders: &[String]) -> Option<String> {
    if format == "h265" {
        if encoders.iter().any(|e| e == "hevc_videotoolbox") {
            return Some("hevc_videotoolbox".to_string());
        }
        if encoders.iter().any(|e| e == "hevc_nvenc") {
            return Some("hevc_nvenc".to_string());
        }
    } else {
        if encoders.iter().any(|e| e == "h264_videotoolbox") {
            return Some("h264_videotoolbox".to_string());
        }
        if encoders.iter().any(|e| e == "h264_nvenc") {
            return Some("h264_nvenc".to_string());
        }
    }
    None
}

fn can_copy_audio(input: &str, container: &str) -> bool {
    let input_ext = Path::new(input)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    // AAC é compatível com MP4, MOV, MKV. Copiar áudio evita re-encoding.
    match container {
        "mp4" => matches!(input_ext.as_str(), "mp4" | "mov" | "m4v" | "mkv"),
        "mkv" => true, // MKV aceita qualquer codec de áudio
        _ => false, // WebM precisa Opus
    }
}

fn build_args(
    input: &str,
    output: &str,
    settings: &CompressionSettings,
    use_hw: bool,
    encoders: &[String],
) -> Vec<String> {
    let mut args = vec!["-y".to_string()];

    // Decodificação por hardware (antes do -i)
    if use_hw {
        #[cfg(target_os = "macos")]
        args.extend_from_slice(&["-hwaccel".to_string(), "videotoolbox".to_string()]);
        #[cfg(target_os = "windows")]
        {
            if encoders.iter().any(|e| e.contains("nvenc")) {
                args.extend_from_slice(&["-hwaccel".to_string(), "cuda".to_string()]);
            } else {
                args.extend_from_slice(&["-hwaccel".to_string(), "d3d11va".to_string()]);
            }
        }
        #[cfg(target_os = "linux")]
        {
            if encoders.iter().any(|e| e.contains("nvenc")) {
                args.extend_from_slice(&["-hwaccel".to_string(), "cuda".to_string()]);
            } else {
                args.extend_from_slice(&["-hwaccel".to_string(), "vaapi".to_string()]);
            }
        }
    }

    args.extend_from_slice(&[
        "-i".to_string(),
        input.to_string(),
        "-map_metadata".to_string(),
        "0".to_string(),
    ]);

    if let Some(ref start) = settings.trim_start {
        if !start.is_empty() {
            args.extend_from_slice(&["-ss".to_string(), start.clone()]);
        }
    }
    if let Some(ref end) = settings.trim_end {
        if !end.is_empty() {
            args.extend_from_slice(&["-to".to_string(), end.clone()]);
        }
    }

    let is_webm = settings.container == "webm";

    if is_webm {
        // WEBM usa VP9 + Opus, ignora codec selecionado
        let crf = match settings.quality.as_str() {
            "alta" => 28,
            "media" => 33,
            _ => 40,
        };
        args.extend_from_slice(&[
            "-c:v".to_string(), "libvpx-vp9".to_string(),
            "-crf".to_string(), crf.to_string(),
            "-b:v".to_string(), "0".to_string(),
            "-cpu-used".to_string(), "6".to_string(),
            "-threads".to_string(), settings.max_threads.unwrap_or(0).to_string(),
        ]);
    } else {
        let hw_encoder = if use_hw {
            get_hw_encoder(&settings.format, encoders)
        } else {
            None
        };

        if let Some(ref enc) = hw_encoder {
            let is_nvenc = enc.contains("nvenc");
            args.extend_from_slice(&["-c:v".to_string(), enc.clone()]);
            if is_nvenc {
                args.extend_from_slice(&[
                    "-cq".to_string(),
                    quality_for_hw(&settings.quality).to_string(),
                    "-preset".to_string(),
                    "p4".to_string(),
                ]);
            } else {
                args.extend_from_slice(&[
                    "-q:v".to_string(),
                    quality_for_hw(&settings.quality).to_string(),
                    "-realtime".to_string(),
                    "1".to_string(),
                ]);
            }
        } else {
            let codec = if settings.format == "h265" { "libx265" } else { "libx264" };
            let crf = quality_for_software(&settings.format, &settings.quality);
            args.extend_from_slice(&[
                "-c:v".to_string(),
                codec.to_string(),
                "-crf".to_string(),
                crf.to_string(),
                "-preset".to_string(),
                "veryfast".to_string(),
                "-threads".to_string(),
                settings.max_threads.unwrap_or(0).to_string(),
            ]);
        }
    }

    match settings.resolution.as_str() {
        "1080p" => args.extend_from_slice(&["-vf".to_string(), "scale=-2:1080".to_string()]),
        "720p" => args.extend_from_slice(&["-vf".to_string(), "scale=-2:720".to_string()]),
        _ => {}
    }

    if settings.remove_audio {
        args.extend_from_slice(&["-an".to_string()]);
    } else if is_webm {
        args.extend_from_slice(&[
            "-c:a".to_string(), "libopus".to_string(),
            "-b:a".to_string(), "128k".to_string(),
        ]);
    } else if can_copy_audio(input, &settings.container) {
        args.extend_from_slice(&["-c:a".to_string(), "copy".to_string()]);
    } else {
        args.extend_from_slice(&[
            "-c:a".to_string(), "aac".to_string(),
            "-b:a".to_string(), "128k".to_string(),
        ]);
    }

    if !is_webm && settings.format == "h265" {
        args.extend_from_slice(&["-tag:v".to_string(), "hvc1".to_string()]);
    }

    if !is_webm {
        args.extend_from_slice(&["-movflags".to_string(), "+faststart".to_string()]);
    }

    args.push(output.to_string());

    args
}

fn parse_time(line: &str) -> Option<f64> {
    let re = Regex::new(r"time=(\d+):(\d+):(\d+\.?\d*)").ok()?;
    let caps = re.captures(line)?;
    let h: f64 = caps[1].parse().ok()?;
    let m: f64 = caps[2].parse().ok()?;
    let s: f64 = caps[3].parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

// ---------- Tipos de PDF ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfJob {
    pub id: String,
    pub input_path: String,
    pub file_name: String,
    pub output_path: String,
    pub input_size: u64,
    pub quality: String, // "screen", "ebook", "printer", "prepress"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfDoneEvent {
    pub job_id: String,
    pub output_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfErrorEvent {
    pub job_id: String,
    pub message: String,
}

// ---------- Comandos Tauri ----------

#[tauri::command]
fn scan_folder(folder_path: String) -> Vec<VideoFile> {
    let mut videos = Vec::new();
    let Ok(entries) = fs::read_dir(&folder_path) else {
        return videos;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{}", e.to_lowercase()))
            .unwrap_or_default();
        if !VIDEO_EXTENSIONS.contains(&ext.as_str()) {
            continue;
        }
        let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        videos.push(VideoFile {
            path: path.to_string_lossy().to_string(),
            size,
        });
    }
    videos
}

#[tauri::command]
fn get_file_size(file_path: String) -> u64 {
    fs::metadata(&file_path).map(|m| m.len()).unwrap_or(0)
}

#[tauri::command]
fn check_disk_space(folder_path: String) -> u64 {
    #[cfg(unix)]
    {
        use std::ffi::CString;
        let c_path = CString::new(folder_path).unwrap_or_default();
        unsafe {
            let mut stat: libc::statvfs = std::mem::zeroed();
            if libc::statvfs(c_path.as_ptr(), &mut stat) == 0 {
                return stat.f_bavail as u64 * stat.f_frsize as u64;
            }
        }
        0
    }
    #[cfg(not(unix))]
    {
        0
    }
}

#[tauri::command]
async fn extract_thumbnail(app: AppHandle, file_path: String) -> Result<String, String> {
    use base64::Engine;

    let temp_dir = std::env::temp_dir();
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    file_path.hash(&mut hasher);
    let hash = hasher.finish();
    let thumb_path = temp_dir.join(format!("vc_thumb_{}.jpg", hash));
    let thumb_str = thumb_path.to_string_lossy().to_string();

    // Se já existe, retornar direto
    if thumb_path.exists() {
        let bytes = fs::read(&thumb_path).map_err(|e| e.to_string())?;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        return Ok(format!("data:image/jpeg;base64,{}", b64));
    }

    let shell = app.shell();
    let output = shell
        .sidecar("ffmpeg")
        .unwrap()
        .args([
            "-i", &file_path,
            "-ss", "1",
            "-vframes", "1",
            "-vf", "scale=160:-2",
            "-q:v", "8",
            "-y",
            &thumb_str,
        ])
        .output()
        .await
        .map_err(|e| format!("Erro ao extrair thumbnail: {}", e))?;

    if !thumb_path.exists() {
        return Err("Falha ao gerar thumbnail".to_string());
    }

    let bytes = fs::read(&thumb_path).map_err(|e| e.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:image/jpeg;base64,{}", b64))
}

#[tauri::command]
async fn probe_duration(app: AppHandle, file_path: String) -> f64 {
    let shell = app.shell();
    let output = shell
        .sidecar("ffprobe")
        .unwrap()
        .args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            &file_path,
        ])
        .output()
        .await;

    match output {
        Ok(out) => {
            let s = String::from_utf8_lossy(&out.stdout);
            s.trim().parse::<f64>().unwrap_or(0.0)
        }
        Err(_) => 0.0,
    }
}

#[tauri::command]
async fn open_folder(folder_path: String) {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(&folder_path).spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer").arg(&folder_path).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(&folder_path).spawn();
    }
}

#[tauri::command]
async fn start_compression(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    jobs: Vec<VideoJob>,
    settings: CompressionSettings,
    _output_dir: String,
    max_parallel: u32,
) -> Result<(), String> {
    {
        *state.cancelled.lock().unwrap() = false;
    }

    let encoders = state.hw_encoders.lock().unwrap().clone();
    let cancelled = state.cancelled.clone();
    let max_parallel = (max_parallel.max(1)) as usize;

    for chunk in jobs.chunks(max_parallel) {
        if *cancelled.lock().unwrap() {
            break;
        }

        let mut handles = Vec::new();

        for job in chunk {
            let app = app.clone();
            let settings = settings.clone();
            let encoders = encoders.clone();
            let cancelled = cancelled.clone();
            let job = job.clone();

            let handle = tokio::spawn(async move {
                if *cancelled.lock().unwrap() {
                    return;
                }

                // Criar pasta de saída
                if let Some(parent) = Path::new(&job.output_path).parent() {
                    let _ = fs::create_dir_all(parent);
                }

                let has_hw = get_hw_encoder(&settings.format, &encoders).is_some();

                // Tenta HW primeiro, fallback para software
                let result = if has_hw {
                    let hw_args = build_args(&job.input_path, &job.output_path, &settings, true, &encoders);
                    let r = run_ffmpeg(&app, &hw_args, &job, &cancelled).await;
                    match r {
                        Ok(size) => Ok(size),
                        Err(_) => {
                            // Limpar arquivo parcial antes do fallback
                            let _ = fs::remove_file(&job.output_path);
                            let _ = app.emit("progress", ProgressEvent {
                                job_id: job.id.clone(),
                                progress: 0,
                            });
                            let sw_args = build_args(&job.input_path, &job.output_path, &settings, false, &encoders);
                            run_ffmpeg(&app, &sw_args, &job, &cancelled).await
                        }
                    }
                } else {
                    let sw_args = build_args(&job.input_path, &job.output_path, &settings, false, &encoders);
                    run_ffmpeg(&app, &sw_args, &job, &cancelled).await
                };

                if *cancelled.lock().unwrap() {
                    return;
                }

                match result {
                    Ok(output_size) => {
                        let _ = app.emit("job-done", JobDoneEvent {
                            job_id: job.id.clone(),
                            output_size,
                        });
                    }
                    Err(msg) => {
                        let _ = app.emit("job-error", JobErrorEvent {
                            job_id: job.id.clone(),
                            message: msg,
                        });
                    }
                }
            });

            handles.push(handle);
        }

        // Aguardar todas as tasks do chunk terminarem
        for handle in handles {
            let _ = handle.await;
        }
    }

    Ok(())
}

async fn run_ffmpeg(
    app: &AppHandle,
    args: &[String],
    job: &VideoJob,
    cancelled: &Arc<Mutex<bool>>,
) -> Result<u64, String> {
    let shell = app.shell();
    let (mut rx, child) = shell
        .sidecar("ffmpeg")
        .unwrap()
        .args(args)
        .spawn()
        .map_err(|e| format!("Erro ao iniciar ffmpeg: {}", e))?;

    let duration = job.duration_seconds;
    let job_id = job.id.clone();
    let app_clone = app.clone();
    let cancelled_clone = cancelled.clone();
    let output_path = job.output_path.clone();

    // Ler eventos do processo (stderr contém o progresso)
    let mut stderr_buf = String::new();
    let mut exited_ok = false;

    while let Some(event) = rx.recv().await {
        if *cancelled_clone.lock().unwrap() {
            let _ = child.kill();
            return Err("Cancelado".to_string());
        }

        match event {
            CommandEvent::Stderr(data) => {
                let line = String::from_utf8_lossy(&data);
                stderr_buf.push_str(&line);

                if let Some(t) = parse_time(&stderr_buf) {
                    if duration > 0.0 {
                        let pct = ((t / duration) * 100.0).min(99.0) as u32;
                        let _ = app_clone.emit("progress", ProgressEvent {
                            job_id: job_id.clone(),
                            progress: pct,
                        });
                    }
                }

                // Limpar buffer se ficou grande (manter só últimos bytes)
                if stderr_buf.len() > 4096 {
                    stderr_buf = stderr_buf[stderr_buf.len() - 512..].to_string();
                }
            }
            CommandEvent::Terminated(payload) => {
                exited_ok = payload.code == Some(0);
            }
            _ => {}
        }
    }

    if !exited_ok {
        return Err("ffmpeg saiu com código de erro".to_string());
    }

    let size = fs::metadata(&output_path)
        .map(|m| m.len())
        .unwrap_or(0);
    Ok(size)
}

// ---------- Comandos de PDF ----------

#[tauri::command]
fn scan_pdfs(folder_path: String) -> Vec<VideoFile> {
    let mut pdfs = Vec::new();
    let Ok(entries) = fs::read_dir(&folder_path) else {
        return pdfs;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();
        if ext != "pdf" {
            continue;
        }
        let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        pdfs.push(VideoFile {
            path: path.to_string_lossy().to_string(),
            size,
        });
    }
    pdfs
}

#[tauri::command]
async fn compress_pdfs(app: AppHandle, jobs: Vec<PdfJob>) -> Result<(), String> {
    for job in &jobs {
        if let Some(parent) = Path::new(&job.output_path).parent() {
            let _ = fs::create_dir_all(parent);
        }

        let gs_path = find_ghostscript();
        let result = std::process::Command::new(&gs_path)
            .args([
                "-sDEVICE=pdfwrite",
                "-dCompatibilityLevel=1.4",
                &format!("-dPDFSETTINGS=/{}", job.quality),
                "-dNOPAUSE",
                "-dQUIET",
                "-dBATCH",
                &format!("-sOutputFile={}", job.output_path),
                &job.input_path,
            ])
            .output();

        match result {
            Ok(output) if output.status.success() => {
                let output_size = fs::metadata(&job.output_path).map(|m| m.len()).unwrap_or(0);
                let _ = app.emit(
                    "pdf-done",
                    PdfDoneEvent {
                        job_id: job.id.clone(),
                        output_size,
                    },
                );
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let _ = app.emit(
                    "pdf-error",
                    PdfErrorEvent {
                        job_id: job.id.clone(),
                        message: format!("Ghostscript error: {}", stderr),
                    },
                );
            }
            Err(e) => {
                let _ = app.emit(
                    "pdf-error",
                    PdfErrorEvent {
                        job_id: job.id.clone(),
                        message: format!("Ghostscript não encontrado. Instale com: brew install ghostscript (Mac) ou apt install ghostscript (Linux). Erro: {}", e),
                    },
                );
            }
        }
    }
    Ok(())
}

fn find_ghostscript() -> String {
    for path in &[
        "gs",
        "/opt/homebrew/bin/gs",
        "/usr/local/bin/gs",
        "/usr/bin/gs",
        "gswin64c",
        "gswin32c",
    ] {
        if std::process::Command::new(path)
            .arg("--version")
            .output()
            .is_ok()
        {
            return path.to_string();
        }
    }
    "gs".to_string()
}

// ---------- Comandos de imagem ----------

#[tauri::command]
fn scan_images(folder_path: String) -> Vec<VideoFile> {
    let mut images = Vec::new();
    let Ok(entries) = fs::read_dir(&folder_path) else {
        return images;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{}", e.to_lowercase()))
            .unwrap_or_default();
        if !IMAGE_EXTENSIONS.contains(&ext.as_str()) {
            continue;
        }
        let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        images.push(VideoFile {
            path: path.to_string_lossy().to_string(),
            size,
        });
    }
    images
}

#[tauri::command]
async fn compress_images(app: AppHandle, jobs: Vec<ImageJob>) -> Result<(), String> {
    for job in &jobs {
        if let Some(parent) = Path::new(&job.output_path).parent() {
            let _ = fs::create_dir_all(parent);
        }

        let result = compress_single_image(job);
        match result {
            Ok(output_size) => {
                let _ = app.emit("image-done", ImageDoneEvent {
                    job_id: job.id.clone(),
                    output_size,
                });
            }
            Err(msg) => {
                let _ = app.emit("image-error", ImageErrorEvent {
                    job_id: job.id.clone(),
                    message: msg,
                });
            }
        }
    }
    Ok(())
}

fn compress_single_image(job: &ImageJob) -> Result<u64, String> {
    let img = image::open(&job.input_path).map_err(|e| format!("Erro ao abrir imagem: {}", e))?;

    match job.output_format.as_str() {
        "jpg" | "jpeg" => {
            let mut output = std::io::BufWriter::new(
                fs::File::create(&job.output_path).map_err(|e| e.to_string())?
            );
            let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output, job.quality as u8);
            img.write_with_encoder(encoder).map_err(|e| e.to_string())?;
        }
        "png" => {
            img.save(&job.output_path).map_err(|e| e.to_string())?;
        }
        "webp" => {
            img.save(&job.output_path).map_err(|e| e.to_string())?;
        }
        _ => {
            img.save(&job.output_path).map_err(|e| e.to_string())?;
        }
    }

    let output_size = fs::metadata(&job.output_path).map(|m| m.len()).unwrap_or(0);
    Ok(output_size)
}

#[tauri::command]
fn image_thumbnail(file_path: String) -> Result<String, String> {
    use base64::Engine;

    let img = image::open(&file_path).map_err(|e| format!("Erro ao abrir imagem: {}", e))?;
    let thumb = img.thumbnail(160, 160);

    let mut buf = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buf);
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, 60);
    thumb.write_with_encoder(encoder).map_err(|e| e.to_string())?;

    let b64 = base64::engine::general_purpose::STANDARD.encode(&buf);
    Ok(format!("data:image/jpeg;base64,{}", b64))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub cpu_cores: usize,
    pub total_ram_mb: u64,
    pub is_low_end: bool,
    pub recommended_parallel: u32,
    pub recommended_threads: u32,
}

#[tauri::command]
fn get_system_info() -> SystemInfo {
    use sysinfo::System;
    let mut sys = System::new_all();
    sys.refresh_all();

    let cpu_cores = sys.cpus().len();
    let total_ram_mb = sys.total_memory() / 1024 / 1024;

    // PC fraco: menos de 4 cores ou menos de 8GB RAM
    let is_low_end = cpu_cores <= 4 || total_ram_mb < 8000;

    let recommended_parallel = if total_ram_mb < 4000 {
        1
    } else if total_ram_mb < 8000 || cpu_cores <= 4 {
        1
    } else if total_ram_mb < 16000 || cpu_cores <= 8 {
        2
    } else {
        3
    };

    // Threads: metade dos cores para deixar margem
    let recommended_threads = ((cpu_cores as u32) / 2).max(1);

    SystemInfo {
        cpu_cores,
        total_ram_mb,
        is_low_end,
        recommended_parallel,
        recommended_threads,
    }
}

#[tauri::command]
fn play_completion_sound() {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("afplay")
            .arg("/System/Library/Sounds/Glass.aiff")
            .spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("powershell")
            .args(["-c", "[System.Media.SystemSounds]::Exclamation.Play()"])
            .spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("paplay")
            .arg("/usr/share/sounds/freedesktop/stereo/complete.oga")
            .spawn();
    }
}

#[tauri::command]
fn get_cpu_usage() -> f32 {
    use sysinfo::System;
    let mut sys = System::new();
    sys.refresh_cpu_usage();
    std::thread::sleep(std::time::Duration::from_millis(200));
    sys.refresh_cpu_usage();
    sys.global_cpu_usage()
}

#[tauri::command]
async fn cancel_all(state: tauri::State<'_, AppState>) -> Result<(), String> {
    *state.cancelled.lock().unwrap() = true;
    Ok(())
}

#[tauri::command]
async fn update_tray_menu(app: AppHandle, jobs: Vec<TrayJobInfo>) -> Result<(), String> {
    let Some(tray) = app.tray_by_id("main") else {
        return Ok(());
    };

    let mut items: Vec<MenuItem<tauri::Wry>> = Vec::new();

    if jobs.is_empty() {
        let idle = MenuItem::with_id(&app, "idle", "Nenhum vídeo na fila", false, None::<&str>)
            .map_err(|e| e.to_string())?;
        items.push(idle);
    } else {
        for job in &jobs {
            let label = match job.status.as_str() {
                "processando" => format!("⚙ {} — {}%", truncate_name(&job.file_name, 30), job.progress),
                "concluido" => format!("✓ {}", truncate_name(&job.file_name, 30)),
                "erro" => format!("✕ {}", truncate_name(&job.file_name, 30)),
                _ => format!("◦ {}", truncate_name(&job.file_name, 30)),
            };
            let item = MenuItem::with_id(&app, &format!("job-{}", job.file_name), &label, false, None::<&str>)
                .map_err(|e| e.to_string())?;
            items.push(item);
        }
    }

    let separator = tauri::menu::PredefinedMenuItem::separator(&app)
        .map_err(|e| e.to_string())?;
    let show_i = MenuItem::with_id(&app, "show", "Abrir Video Compressor", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let quit_i = MenuItem::with_id(&app, "quit", "Sair", true, None::<&str>)
        .map_err(|e| e.to_string())?;

    let menu_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = {
        let mut refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = items.iter().map(|i| i as &dyn tauri::menu::IsMenuItem<tauri::Wry>).collect();
        refs.push(&separator);
        refs.push(&show_i);
        refs.push(&quit_i);
        refs
    };

    let menu = Menu::with_items(&app, &menu_refs)
        .map_err(|e| e.to_string())?;

    tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;

    // Atualizar tooltip com resumo
    let processing = jobs.iter().filter(|j| j.status == "processando").count();
    let pending = jobs.iter().filter(|j| j.status == "pendente").count();
    let tooltip = if processing > 0 {
        format!("Video Compressor — {} comprimindo, {} na fila", processing, pending)
    } else {
        "Video Compressor".to_string()
    };
    let _ = tray.set_tooltip(Some(&tooltip));

    Ok(())
}

fn truncate_name(name: &str, max: usize) -> String {
    if name.len() <= max {
        name.to_string()
    } else {
        format!("{}…", &name[..max - 1])
    }
}

// ---------- Comandos de áudio ----------

#[tauri::command]
fn scan_audio(folder_path: String) -> Vec<VideoFile> {
    let mut audios = Vec::new();
    let Ok(entries) = fs::read_dir(&folder_path) else {
        return audios;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{}", e.to_lowercase()))
            .unwrap_or_default();
        if !AUDIO_EXTENSIONS.contains(&ext.as_str()) {
            continue;
        }
        let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        audios.push(VideoFile {
            path: path.to_string_lossy().to_string(),
            size,
        });
    }
    audios
}

#[tauri::command]
async fn compress_audio(app: AppHandle, jobs: Vec<AudioJob>) -> Result<(), String> {
    let shell = app.shell();

    for job in &jobs {
        if let Some(parent) = Path::new(&job.output_path).parent() {
            let _ = fs::create_dir_all(parent);
        }

        let mut args = vec![
            "-y".to_string(),
            "-i".to_string(), job.input_path.clone(),
        ];

        match job.output_format.as_str() {
            "mp3" => {
                args.extend_from_slice(&[
                    "-c:a".to_string(), "libmp3lame".to_string(),
                    "-b:a".to_string(), job.bitrate.clone(),
                ]);
            }
            "aac" | "m4a" => {
                args.extend_from_slice(&[
                    "-c:a".to_string(), "aac".to_string(),
                    "-b:a".to_string(), job.bitrate.clone(),
                ]);
            }
            "ogg" => {
                args.extend_from_slice(&[
                    "-c:a".to_string(), "libvorbis".to_string(),
                    "-b:a".to_string(), job.bitrate.clone(),
                ]);
            }
            "flac" => {
                args.extend_from_slice(&[
                    "-c:a".to_string(), "flac".to_string(),
                ]);
            }
            "wav" => {
                args.extend_from_slice(&[
                    "-c:a".to_string(), "pcm_s16le".to_string(),
                ]);
            }
            _ => {
                args.extend_from_slice(&[
                    "-b:a".to_string(), job.bitrate.clone(),
                ]);
            }
        }

        args.push(job.output_path.clone());

        let output = shell.sidecar("ffmpeg").unwrap()
            .args(&args)
            .output()
            .await;

        match output {
            Ok(out) if out.status.success() => {
                let size = fs::metadata(&job.output_path).map(|m| m.len()).unwrap_or(0);
                let _ = app.emit("audio-done", AudioDoneEvent {
                    job_id: job.id.clone(),
                    output_size: size,
                });
            }
            Ok(out) => {
                let stderr = String::from_utf8_lossy(&out.stderr);
                let _ = app.emit("audio-error", AudioErrorEvent {
                    job_id: job.id.clone(),
                    message: format!("ffmpeg error: {}", stderr.chars().take(200).collect::<String>()),
                });
            }
            Err(e) => {
                let _ = app.emit("audio-error", AudioErrorEvent {
                    job_id: job.id.clone(),
                    message: format!("Erro: {}", e),
                });
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn extract_audio_from_video(app: AppHandle, jobs: Vec<ExtractAudioJob>) -> Result<(), String> {
    let shell = app.shell();

    for job in &jobs {
        if let Some(parent) = Path::new(&job.output_path).parent() {
            let _ = fs::create_dir_all(parent);
        }

        let mut args = vec![
            "-y".to_string(),
            "-i".to_string(), job.input_path.clone(),
            "-vn".to_string(),
        ];

        match job.output_format.as_str() {
            "mp3" => args.extend_from_slice(&["-c:a".to_string(), "libmp3lame".to_string(), "-b:a".to_string(), job.bitrate.clone()]),
            "aac" => args.extend_from_slice(&["-c:a".to_string(), "aac".to_string(), "-b:a".to_string(), job.bitrate.clone()]),
            "flac" => args.extend_from_slice(&["-c:a".to_string(), "flac".to_string()]),
            "wav" => args.extend_from_slice(&["-c:a".to_string(), "pcm_s16le".to_string()]),
            "ogg" => args.extend_from_slice(&["-c:a".to_string(), "libvorbis".to_string(), "-b:a".to_string(), job.bitrate.clone()]),
            _ => args.extend_from_slice(&["-b:a".to_string(), job.bitrate.clone()]),
        }

        args.push(job.output_path.clone());

        let output = shell.sidecar("ffmpeg").unwrap()
            .args(&args)
            .output()
            .await;

        match output {
            Ok(out) if out.status.success() => {
                let size = fs::metadata(&job.output_path).map(|m| m.len()).unwrap_or(0);
                let _ = app.emit("audio-done", AudioDoneEvent {
                    job_id: job.id.clone(),
                    output_size: size,
                });
            }
            Ok(out) => {
                let stderr = String::from_utf8_lossy(&out.stderr);
                let _ = app.emit("audio-error", AudioErrorEvent {
                    job_id: job.id.clone(),
                    message: format!("ffmpeg error: {}", stderr.chars().take(200).collect::<String>()),
                });
            }
            Err(e) => {
                let _ = app.emit("audio-error", AudioErrorEvent {
                    job_id: job.id.clone(),
                    message: format!("Erro: {}", e),
                });
            }
        }
    }
    Ok(())
}

// ---------- Tipos de conversão ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertJob {
    pub id: String,
    pub input_path: String,
    pub file_name: String,
    pub output_path: String,
    pub input_size: u64,
    pub output_format: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertDoneEvent {
    pub job_id: String,
    pub output_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertErrorEvent {
    pub job_id: String,
    pub message: String,
}

#[tauri::command]
async fn convert_files(app: AppHandle, jobs: Vec<ConvertJob>) -> Result<(), String> {
    let shell = app.shell();

    for job in &jobs {
        if let Some(parent) = Path::new(&job.output_path).parent() {
            let _ = fs::create_dir_all(parent);
        }

        let input_ext = Path::new(&job.input_path)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();

        let is_image_input = IMAGE_EXTENSIONS.iter().any(|e| e.trim_start_matches('.') == input_ext);

        let result = if is_image_input {
            // Conversão de imagem usando crate image
            match image::open(&job.input_path) {
                Ok(img) => {
                    match img.save(&job.output_path) {
                        Ok(_) => Ok(fs::metadata(&job.output_path).map(|m| m.len()).unwrap_or(0)),
                        Err(e) => Err(format!("Erro ao salvar: {}", e)),
                    }
                }
                Err(e) => Err(format!("Erro ao abrir: {}", e)),
            }
        } else {
            // Conversão de vídeo/áudio via ffmpeg
            let is_audio_only = AUDIO_EXTENSIONS.iter().any(|e| e.trim_start_matches('.') == input_ext);
            let out_ext = Path::new(&job.output_path)
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase())
                .unwrap_or_default();

            // WebM precisa re-encoding (VP9+Opus), não suporta -c copy de H.264
            let needs_reencode = out_ext == "webm" || out_ext == "ogg"
                || (out_ext == "avi" && input_ext == "webm")
                || is_audio_only;

            let mut args = vec!["-y".to_string(), "-i".to_string(), job.input_path.clone()];

            if needs_reencode {
                if out_ext == "webm" {
                    args.extend_from_slice(&[
                        "-c:v".to_string(), "libvpx-vp9".to_string(),
                        "-crf".to_string(), "30".to_string(),
                        "-b:v".to_string(), "0".to_string(),
                        "-cpu-used".to_string(), "6".to_string(),
                        "-c:a".to_string(), "libopus".to_string(),
                        "-b:a".to_string(), "128k".to_string(),
                    ]);
                }
                // Áudio e outros: deixar ffmpeg decidir o codec
            } else {
                args.extend_from_slice(&[
                    "-c".to_string(), "copy".to_string(),
                    "-movflags".to_string(), "+faststart".to_string(),
                ]);
            }

            args.push(job.output_path.clone());

            let (mut rx, _child) = shell.sidecar("ffmpeg").unwrap()
                .args(&args)
                .spawn()
                .map_err(|e| format!("Erro ao iniciar ffmpeg: {}", e))?;

            let mut exited_ok = false;
            while let Some(event) = rx.recv().await {
                if let CommandEvent::Terminated(payload) = event {
                    exited_ok = payload.code == Some(0);
                }
            }

            if exited_ok {
                Ok(fs::metadata(&job.output_path).map(|m| m.len()).unwrap_or(0))
            } else {
                Err("ffmpeg saiu com código de erro".to_string())
            }
        };

        match result {
            Ok(output_size) => {
                let _ = app.emit("convert-done", ConvertDoneEvent {
                    job_id: job.id.clone(),
                    output_size,
                });
            }
            Err(msg) => {
                let _ = app.emit("convert-error", ConvertErrorEvent {
                    job_id: job.id.clone(),
                    message: msg,
                });
            }
        }
    }
    Ok(())
}

// ---------- Detecção de HW encoders ----------

async fn detect_hw_encoders(app: &AppHandle) -> Vec<String> {
    let shell = app.shell();
    let output = shell
        .sidecar("ffmpeg")
        .unwrap()
        .args(["-hide_banner", "-encoders"])
        .output()
        .await;

    let Ok(out) = output else {
        return vec![];
    };

    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut encoders = Vec::new();

    if stdout.contains("h264_videotoolbox") {
        encoders.push("h264_videotoolbox".to_string());
    }
    if stdout.contains("hevc_videotoolbox") {
        encoders.push("hevc_videotoolbox".to_string());
    }
    if stdout.contains("h264_nvenc") {
        encoders.push("h264_nvenc".to_string());
    }
    if stdout.contains("hevc_nvenc") {
        encoders.push("hevc_nvenc".to_string());
    }

    encoders
}

// ---------- Bootstrap ----------

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            // Emitir arquivos recebidos via linha de comando
            let files: Vec<String> = args.iter()
                .skip(1)
                .filter(|a| !a.starts_with('-'))
                .filter(|a| Path::new(a).exists())
                .cloned()
                .collect();
            if !files.is_empty() {
                let _ = app.emit("open-files", files);
            }
        }))
        .manage(AppState {
            hw_encoders: Mutex::new(Vec::new()),
            cancelled: Arc::new(Mutex::new(false)),
        })
        .setup(|app| {
            // Emitir arquivos passados como argumentos na abertura
            let args: Vec<String> = std::env::args().collect();
            let files: Vec<String> = args.iter()
                .skip(1)
                .filter(|a| !a.starts_with('-'))
                .filter(|a| Path::new(a).exists())
                .cloned()
                .collect();
            if !files.is_empty() {
                let handle_files = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                    let _ = handle_files.emit("open-files", files);
                });
            }

            // Detectar encoders de hardware
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let encoders = detect_hw_encoders(&handle).await;
                let state = handle.state::<AppState>();
                *state.hw_encoders.lock().unwrap() = encoders;
            });

            // System tray
            let show_i = MenuItem::with_id(app, "show", "Abrir Video Compressor", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Video Compressor")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // Esconder janela ao fechar (em vez de encerrar)
            let window = app.get_webview_window("main").unwrap();
            let window_clone = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window_clone.hide();
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_folder,
            get_file_size,
            check_disk_space,
            extract_thumbnail,
            probe_duration,
            open_folder,
            start_compression,
            cancel_all,
            update_tray_menu,
            get_cpu_usage,
            play_completion_sound,
            get_system_info,
            scan_images,
            compress_images,
            image_thumbnail,
            scan_pdfs,
            compress_pdfs,
            scan_audio,
            compress_audio,
            extract_audio_from_video,
            convert_files,
        ])
        .run(tauri::generate_context!())
        .expect("Erro ao iniciar o app");
}
