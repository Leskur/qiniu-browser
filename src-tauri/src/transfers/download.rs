use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use log::info;
use tauri::{AppHandle, Emitter};

#[derive(serde::Serialize, Clone)]
struct DownloadProgressEvent {
    task_id: String,
    file_name: String,
    url: String,
    total_size: u64,
    downloaded_size: u64,
    progress: f64,
    status: String, // "downloading", "completed", "failed"
    error: Option<String>,
}

#[derive(serde::Serialize)]
pub(crate) struct DownloadResult {
    downloaded: Vec<String>,
    failed: Vec<String>,
}

fn batch_download_path(root: &Path, name: &str) -> Result<PathBuf, String> {
    // Object keys use forward slashes. Reject platform-specific separators and prefixes.
    if name.split('/').any(|part| part.is_empty() || part == "." || part == "..")
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

fn write_new_download(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(path)?;
    let result = file.write_all(bytes);
    drop(file);
    if result.is_err() {
        let _ = fs::remove_file(path);
    }
    result
}

#[cfg(test)]
mod batch_download_tests {
    use super::*;

    #[test]
    fn download_rejects_paths_outside_the_destination() {
        let root = std::env::temp_dir();
        for name in ["../outside.txt", "/absolute.txt", "nested/../other.txt", "nested\\other.txt", "file.txt:stream"] {
            assert!(batch_download_path(&root, name).is_err(), "{name}");
        }
    }

    #[test]
    fn download_creates_nested_files_without_overwriting() {
        let dir = std::env::temp_dir().join(format!("qiniu-download-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let root = fs::canonicalize(&dir).unwrap();
        let path = batch_download_path(&root, "folder/file.txt").unwrap();
        assert_eq!(path, root.join("folder").join("file.txt"));
        write_new_download(&path, b"original").unwrap();
        assert_eq!(
            write_new_download(&path, b"replacement").unwrap_err().kind(),
            std::io::ErrorKind::AlreadyExists
        );
        assert_eq!(fs::read(&path).unwrap(), b"original");
        fs::remove_file(path).unwrap();
        fs::remove_dir(root.join("folder")).unwrap();
        fs::remove_dir(root).unwrap();
    }
}

#[tauri::command]
pub(crate) async fn download_files_to_dir(
    app: AppHandle,
    items: Vec<(String, String)>, // (url, filename)
    dir: String,
    task_ids: Vec<String>,
) -> Result<DownloadResult, String> {
    if items.len() != task_ids.len() {
        return Err("下载文件与任务数量不一致".into());
    }
    info!("批量下载开始: dir={}, files={}", dir, items.len());
    use std::sync::Arc;
    let dir_path = fs::canonicalize(dir).map_err(|error| error.to_string())?;
    if !dir_path.is_dir() {
        return Err("所选下载位置不是文件夹".into());
    }
    let client = reqwest::Client::new();
    let concurrency = Arc::new(tokio::sync::Semaphore::new(8));
    let downloaded = Arc::new(Mutex::new(Vec::<String>::new()));
    let failed = Arc::new(Mutex::new(Vec::<String>::new()));

    let handles: Vec<_> = items.into_iter().zip(task_ids).map(|((url, filename), task_id)| {
        let root = dir_path.clone();
        let client = client.clone();
        let concurrency = Arc::clone(&concurrency);
        let dl = Arc::clone(&downloaded);
        let fl = Arc::clone(&failed);
        let app_clone = app.clone();

        tokio::spawn(async move {
            let _permit = concurrency.acquire().await.expect("download semaphore stays open");
            // Emit start event
            let _ = app_clone.emit("download-progress", DownloadProgressEvent {
                task_id: task_id.clone(),
                file_name: filename.clone(),
                url: url.clone(),
                total_size: 0,
                downloaded_size: 0,
                progress: 0.0,
                status: "downloading".to_string(),
                error: None,
            });

            match client.get(&url).send().await {
                Ok(resp) if resp.status().is_success() => {
                    let total_size = resp.content_length().unwrap_or(0);
                    match resp.bytes().await {
                        Ok(bytes) => {
                            let downloaded_size = bytes.len() as u64;

                            // Create parent directories if they don't exist
                            let saved = tauri::async_runtime::spawn_blocking({
                                let filename = filename.clone();
                                move || {
                                    let path = batch_download_path(&root, &filename)?;
                                    write_new_download(&path, &bytes).map_err(|error| {
                                        if error.kind() == std::io::ErrorKind::AlreadyExists {
                                            "目标文件已存在，未覆盖".into()
                                        } else {
                                            error.to_string()
                                        }
                                    })
                                }
                            }).await.unwrap_or_else(|error| Err(error.to_string()));
                            match saved {
                                Ok(_) => {
                                    dl.lock().unwrap().push(filename.clone());
                                    // Emit success event
                                    let _ = app_clone.emit("download-progress", DownloadProgressEvent {
                                        task_id,
                                        file_name: filename,
                                        url,
                                        total_size,
                                        downloaded_size,
                                        progress: 100.0,
                                        status: "completed".to_string(),
                                        error: None,
                                    });
                                },
                                Err(e) => {
                                    let error_msg = format!("{}: {}", filename, e);
                                    fl.lock().unwrap().push(error_msg.clone());
                                    let _ = app_clone.emit("download-progress", DownloadProgressEvent {
                                        task_id,
                                        file_name: filename,
                                        url,
                                        total_size,
                                        downloaded_size: 0,
                                        progress: 0.0,
                                        status: "failed".to_string(),
                                        error: Some(error_msg),
                                    });
                                },
                            }
                        },
                        Err(e) => {
                            let error_msg = format!("{}: {}", filename, e);
                            fl.lock().unwrap().push(error_msg.clone());
                            let _ = app_clone.emit("download-progress", DownloadProgressEvent {
                                task_id,
                                file_name: filename,
                                url,
                                total_size,
                                downloaded_size: 0,
                                progress: 0.0,
                                status: "failed".to_string(),
                                error: Some(error_msg),
                            });
                        },
                    }
                }
                Ok(resp) => {
                    let error_msg = format!("{}: HTTP {}", filename, resp.status());
                    fl.lock().unwrap().push(error_msg.clone());
                    let _ = app_clone.emit("download-progress", DownloadProgressEvent {
                        task_id,
                        file_name: filename,
                        url,
                        total_size: 0,
                        downloaded_size: 0,
                        progress: 0.0,
                        status: "failed".to_string(),
                        error: Some(error_msg),
                    });
                },
                Err(e) => {
                    let error_msg = format!("{}: {}", filename, e);
                    fl.lock().unwrap().push(error_msg.clone());
                    let _ = app_clone.emit("download-progress", DownloadProgressEvent {
                        task_id,
                        file_name: filename,
                        url,
                        total_size: 0,
                        downloaded_size: 0,
                        progress: 0.0,
                        status: "failed".to_string(),
                        error: Some(error_msg),
                    });
                },
            }
        })
    }).collect();

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
    let response = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("下载失败: HTTP {}", response.status()));
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    let path = PathBuf::from(&save_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(())
}
