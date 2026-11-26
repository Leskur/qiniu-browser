use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use log::info;
use tauri::{AppHandle, Emitter};
use tempfile::NamedTempFile;
use tokio::io::AsyncWriteExt;

const DOWNLOAD_WRITE_BUFFER: usize = 64 * 1024;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

#[derive(serde::Serialize, Clone)]
struct DownloadProgressEvent {
    task_id: String,
    file_name: String,
    url: String,
    total_size: u64,
    downloaded_size: u64,
    progress: f64,
    status: String,
    error: Option<String>,
}

#[derive(serde::Serialize)]
pub(crate) struct DownloadResult {
    downloaded: Vec<String>,
    failed: Vec<String>,
}

#[derive(Clone, Copy)]
enum ExistingFilePolicy {
    Overwrite,
    Reject,
}

#[derive(Clone, Copy, Default)]
struct DownloadStats {
    total_size: u64,
    downloaded_size: u64,
}

fn batch_download_path(root: &Path, name: &str) -> Result<PathBuf, String> {
    // Object keys use forward slashes. Reject platform-specific separators and prefixes.
    if name
        .split('/')
        .any(|part| part.is_empty() || part == "." || part == "..")
        || name.contains(['\\', ':'])
    {
        return Err("无效的下载相对路径".into());
    }
    let mut components = Path::new(name).components().peekable();
    let mut parent = root.to_path_buf();
    while let Some(component) = components.next() {
        let Component::Normal(segment) = component else {
            return Err("无效的下载相对路径".into());
        };
        if cfg!(windows) && segment.to_string_lossy().ends_with([' ', '.']) {
            return Err("Windows 文件名不能以空格或句点结尾".into());
        }
        let next = parent.join(segment);
        if components.peek().is_none() {
            return Ok(next);
        }
        match fs::create_dir(&next) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.to_string()),
        }
        parent = fs::canonicalize(next).map_err(|error| error.to_string())?;
        if !parent.starts_with(root) || !parent.is_dir() {
            return Err("下载路径超出所选目录或不是文件夹".into());
        }
    }
    Err("无效的下载相对路径".into())
}

fn prepare_download(
    path: &Path,
    policy: ExistingFilePolicy,
) -> std::io::Result<(NamedTempFile, fs::File)> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    if matches!(policy, ExistingFilePolicy::Reject) {
        match fs::symlink_metadata(path) {
            Ok(_) => return Err(std::io::ErrorKind::AlreadyExists.into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    let temporary = tempfile::Builder::new()
        .prefix(".qiniu-download-")
        .suffix(".part")
        .tempfile_in(parent)?;
    let writer = temporary.as_file().try_clone()?;
    Ok((temporary, writer))
}

fn file_error(error: &std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::AlreadyExists {
        "目标文件已存在，未覆盖".into()
    } else {
        error.to_string()
    }
}

/// Writes each HTTP chunk to a bounded file buffer. Only a complete response is published.
async fn download_to_path(
    client: &reqwest::Client,
    url: &str,
    path: &Path,
    policy: ExistingFilePolicy,
    mut on_progress: impl FnMut(DownloadStats),
) -> Result<DownloadStats, String> {
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let expected_size = response.content_length();
    let mut stats = DownloadStats {
        total_size: expected_size.unwrap_or(0),
        downloaded_size: 0,
    };
    on_progress(stats);

    let target = path.to_path_buf();
    let (temporary, writer) =
        tauri::async_runtime::spawn_blocking(move || prepare_download(&target, policy))
            .await
            .map_err(|error| error.to_string())?
            .map_err(|error| file_error(&error))?;
    let mut writer = tokio::fs::File::from_std(writer);
    writer.set_max_buf_size(DOWNLOAD_WRITE_BUFFER);

    let transferred = async {
        while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
            writer
                .write_all(&chunk)
                .await
                .map_err(|error| error.to_string())?;
            stats.downloaded_size += chunk.len() as u64;
            on_progress(stats);
        }
        writer.flush().await.map_err(|error| error.to_string())?;
        if expected_size.is_some_and(|expected| expected != stats.downloaded_size) {
            return Err("下载未完成：文件大小与响应声明不一致".into());
        }
        Ok::<_, String>(())
    }
    .await;

    // Finish in-flight disk I/O and close the cloned handle before cleanup or publication.
    drop(writer.into_std().await);
    transferred?;

    let target = path.to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        let result = match policy {
            ExistingFilePolicy::Overwrite => temporary.persist(&target),
            ExistingFilePolicy::Reject => temporary.persist_noclobber(&target),
        };
        // On failure PersistError still owns the temporary file, so dropping it removes it.
        result.map(|_| ()).map_err(|error| file_error(&error.error))
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(stats)
}

fn emit_progress(
    app: &AppHandle,
    task_id: &str,
    filename: &str,
    url: &str,
    stats: DownloadStats,
    status: &str,
    error: Option<String>,
) {
    let progress = if status == "completed" {
        100.0
    } else if stats.total_size > 0 {
        (stats.downloaded_size as f64 / stats.total_size as f64 * 100.0).min(100.0)
    } else {
        0.0
    };
    let _ = app.emit(
        "download-progress",
        DownloadProgressEvent {
            task_id: task_id.into(),
            file_name: filename.into(),
            url: url.into(),
            total_size: stats.total_size,
            downloaded_size: stats.downloaded_size,
            progress,
            status: status.into(),
            error,
        },
    );
}

#[tauri::command]
pub(crate) async fn download_files_to_dir(
    app: AppHandle,
    items: Vec<(String, String)>,
    dir: String,
    task_ids: Vec<String>,
) -> Result<DownloadResult, String> {
    if items.len() != task_ids.len() {
        return Err("下载文件与任务数量不一致".into());
    }
    info!("批量下载开始: dir={}, files={}", dir, items.len());
    let dir_path = fs::canonicalize(dir).map_err(|error| error.to_string())?;
    if !dir_path.is_dir() {
        return Err("所选下载位置不是文件夹".into());
    }
    let client = reqwest::Client::new();
    let concurrency = Arc::new(tokio::sync::Semaphore::new(8));
    let downloaded = Arc::new(Mutex::new(Vec::<String>::new()));
    let failed = Arc::new(Mutex::new(Vec::<String>::new()));

    let handles: Vec<_> = items
        .into_iter()
        .zip(task_ids)
        .map(|((url, filename), task_id)| {
            let root = dir_path.clone();
            let client = client.clone();
            let concurrency = Arc::clone(&concurrency);
            let downloaded = Arc::clone(&downloaded);
            let failed = Arc::clone(&failed);
            let app = app.clone();
            tokio::spawn(async move {
                let _permit = concurrency
                    .acquire()
                    .await
                    .expect("download semaphore stays open");
                let mut stats = DownloadStats::default();
                emit_progress(&app, &task_id, &filename, &url, stats, "downloading", None);
                let mut last_progress = Instant::now();
                let result = async {
                    let name = filename.clone();
                    let path = tauri::async_runtime::spawn_blocking(move || {
                        batch_download_path(&root, &name)
                    })
                    .await
                    .map_err(|error| error.to_string())??;
                    download_to_path(
                        &client,
                        &url,
                        &path,
                        ExistingFilePolicy::Reject,
                        |current| {
                            stats = current;
                            if current.downloaded_size == 0
                                || last_progress.elapsed() >= PROGRESS_INTERVAL
                            {
                                emit_progress(
                                    &app,
                                    &task_id,
                                    &filename,
                                    &url,
                                    current,
                                    "downloading",
                                    None,
                                );
                                last_progress = Instant::now();
                            }
                        },
                    )
                    .await
                }
                .await;
                match result {
                    Ok(stats) => {
                        downloaded.lock().unwrap().push(filename.clone());
                        emit_progress(&app, &task_id, &filename, &url, stats, "completed", None);
                    }
                    Err(error) => {
                        let message = format!("{}: {}", filename, error);
                        failed.lock().unwrap().push(message.clone());
                        emit_progress(
                            &app,
                            &task_id,
                            &filename,
                            &url,
                            stats,
                            "failed",
                            Some(message),
                        );
                    }
                }
            })
        })
        .collect();

    let mut join_error = None;
    for handle in handles {
        if let Err(error) = handle.await {
            join_error = Some(error);
        }
    }
    if let Some(error) = join_error {
        return Err(format!("下载任务异常: {error}"));
    }
    Ok(DownloadResult {
        downloaded: Arc::try_unwrap(downloaded).unwrap().into_inner().unwrap(),
        failed: Arc::try_unwrap(failed).unwrap().into_inner().unwrap(),
    })
}

#[tauri::command]
pub(crate) async fn download_file(url: String, save_path: String) -> Result<(), String> {
    download_to_path(
        &reqwest::Client::new(),
        &url,
        Path::new(&save_path),
        ExistingFilePolicy::Overwrite,
        |_| {},
    )
    .await
    .map(|_| ())
    .map_err(|error| format!("下载失败: {error}"))
}

#[cfg(test)]
mod tests;
