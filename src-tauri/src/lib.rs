use std::fs;
use std::path::PathBuf;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_histories() -> Result<String, String> {
    let home_path_str = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Cannot find home directory".to_string())?;

    let mut path = PathBuf::from(home_path_str);
    path.push(".qiniu-browser");
    path.push("ak_histories.json");

    if path.exists() {
        fs::read_to_string(path).map_err(|e| e.to_string())
    } else {
        // Return empty history if file doesn't exist
        Ok(r#"{"historyItems":[]}"#.to_string())
    }
}

#[tauri::command]
fn get_kodo_histories() -> Result<String, String> {
    let home_path_str = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Cannot find home directory".to_string())?;

    let mut path = PathBuf::from(home_path_str);
    path.push(".kodo-browser-v2");
    path.push("ak_histories.json");

    if path.exists() {
        fs::read_to_string(path).map_err(|e| e.to_string())
    } else {
        Err("ak_histories.json not found".into())
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryItem {
    endpoint_type: String,
    access_key: String,
    access_secret: String,
    remember_me: bool,
    description: String,
}

#[tauri::command]
fn save_history(new_item: HistoryItem) -> Result<(), String> {
    let home_path_str = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Cannot find home directory".to_string())?;

    let mut app_dir = PathBuf::from(home_path_str);
    app_dir.push(".qiniu-browser");

    if !app_dir.exists() {
        fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    }

    let history_path = app_dir.join("ak_histories.json");

    let mut history: serde_json::Value = if history_path.exists() {
        let content = fs::read_to_string(&history_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        serde_json::json!({ "historyItems": [] })
    };

    if let Some(items) = history.get_mut("historyItems").and_then(|v| v.as_array_mut()) {
        // Remove existing item with same access key
        items.retain(|item| {
            item.get("accessKey")
                .and_then(|v| v.as_str())
                .map(|ak| ak != new_item.access_key)
                .unwrap_or(true)
        });
        // Add new item
        items.push(serde_json::json!({
            "endpointType": new_item.endpoint_type,
            "accessKey": new_item.access_key,
            "accessSecret": new_item.access_secret,
            "rememberMe": new_item.remember_me,
            "description": new_item.description
        }));
    }

    fs::write(&history_path, serde_json::to_string_pretty(&history).unwrap())
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn delete_history(access_key: String) -> Result<(), String> {
    let home_path_str = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Cannot find home directory".to_string())?;

    let mut app_dir = PathBuf::from(home_path_str);
    app_dir.push(".qiniu-browser");

    let history_path = app_dir.join("ak_histories.json");

    if !history_path.exists() {
        return Err("History file not found".into());
    }

    let content = fs::read_to_string(&history_path).map_err(|e| e.to_string())?;
    let mut history: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    if let Some(items) = history.get_mut("historyItems").and_then(|v| v.as_array_mut()) {
        let original_len = items.len();
        items.retain(|item| {
            item.get("accessKey")
                .and_then(|v| v.as_str())
                .map(|ak| ak != access_key)
                .unwrap_or(true)
        });

        if items.len() == original_len {
            return Err("History item not found".into());
        }
    }

    fs::write(&history_path, serde_json::to_string_pretty(&history).unwrap())
        .map_err(|e| e.to_string())?;

    Ok(())
}

use qiniu_sdk::credential::Credential;
use qiniu_sdk::upload::{UploadManager, UploadTokenSigner, AutoUploaderObjectParams, AutoUploader};
use std::time::Duration;
use rayon::prelude::*;
use std::sync::{Mutex, Arc};
use tauri::{Emitter, AppHandle};


fn collect_files(paths: Vec<String>) -> Vec<(PathBuf, String)> {
    let mut result = Vec::new();
    for path_str in paths {
        let path = PathBuf::from(&path_str);
        if path.is_dir() {
            // Walk directory and collect all files, preserving relative paths as keys
            let base = path.clone();
            let walker = walkdir::WalkDir::new(&path).into_iter().filter_map(|e| e.ok());
            for entry in walker {
                if entry.file_type().is_file() {
                    let file_path = entry.path().to_path_buf();
                    // Use relative path from the parent of the directory as key
                    let key = file_path
                        .strip_prefix(base.parent().unwrap_or(&base))
                        .unwrap_or(&file_path)
                        .to_string_lossy()
                        .replace('\\', "/");
                    result.push((file_path, key));
                }
            }
        } else {
            // Single file — use just the filename as key
            let key = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string();
            result.push((path, key));
        }
    }
    result
}

#[derive(serde::Serialize, Clone)]
struct UploadProgressEvent {
    task_id: String,
    file_name: String,
    file_path: String,
    total_size: u64,
    uploaded_size: u64,
    progress: f64,
    status: String, // "uploading", "completed", "failed"
    error: Option<String>,
}

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
struct UploadResult {
    uploaded: Vec<String>,
    failed: Vec<String>,
}

#[tauri::command]
async fn upload_files(
    app: AppHandle,
    ak: String,
    sk: String,
    bucket: String,
    file_paths: Vec<String>,
) -> Result<UploadResult, String> {
    let app_clone = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let upload_manager = UploadManager::builder(
            UploadTokenSigner::new_credential_provider(
                Credential::new(&ak, &sk),
                &bucket,
                Duration::from_secs(3600),
            )
        ).build();

        let files = collect_files(file_paths);
        let uploaded: Mutex<Vec<String>> = Mutex::new(Vec::new());
        let failed: Mutex<Vec<String>> = Mutex::new(Vec::new());

        files.par_iter().for_each(|(path, key)| {
            let task_id = uuid::Uuid::new_v4().to_string();
            let file_name = key.clone();
            let file_path = path.to_string_lossy().to_string();
            
            // Get file size
            let total_size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
            
            // Emit start event
            let _ = app_clone.emit("upload-progress", UploadProgressEvent {
                task_id: task_id.clone(),
                file_name: file_name.clone(),
                file_path: file_path.clone(),
                total_size,
                uploaded_size: 0,
                progress: 0.0,
                status: "uploading".to_string(),
                error: None,
            });

            let auto_uploader: AutoUploader<md5::Md5> = upload_manager.auto_uploader();
            let auto_params = AutoUploaderObjectParams::builder()
                .object_name(key.clone())
                .build();
            
            match auto_uploader.upload_path(path, auto_params) {
                Ok(_) => {
                    uploaded.lock().unwrap().push(key.clone());
                    // Emit success event
                    let _ = app_clone.emit("upload-progress", UploadProgressEvent {
                        task_id,
                        file_name,
                        file_path,
                        total_size,
                        uploaded_size: total_size,
                        progress: 100.0,
                        status: "completed".to_string(),
                        error: None,
                    });
                },
                Err(e) => {
                    let error_msg = format!("{}: {}", key, e);
                    failed.lock().unwrap().push(error_msg.clone());
                    // Emit error event
                    let _ = app_clone.emit("upload-progress", UploadProgressEvent {
                        task_id,
                        file_name,
                        file_path,
                        total_size,
                        uploaded_size: 0,
                        progress: 0.0,
                        status: "failed".to_string(),
                        error: Some(error_msg),
                    });
                },
            }
        });

        Ok(UploadResult {
            uploaded: uploaded.into_inner().unwrap(),
            failed: failed.into_inner().unwrap(),
        })
    }).await.unwrap_or_else(|e| Err(format!("Task panicked: {}", e)))
}

#[derive(serde::Serialize)]
struct DownloadResult {
    downloaded: Vec<String>,
    failed: Vec<String>,
}

#[tauri::command]
async fn download_files_to_dir(
    app: AppHandle,
    items: Vec<(String, String)>, // (url, filename)
    dir: String,
) -> Result<DownloadResult, String> {
    use std::sync::Arc;
    let dir_path = PathBuf::from(dir);
    let downloaded = Arc::new(Mutex::new(Vec::<String>::new()));
    let failed = Arc::new(Mutex::new(Vec::<String>::new()));

    let handles: Vec<_> = items.into_iter().map(|(url, filename)| {
        let save_path = dir_path.join(&filename);
        let dl = Arc::clone(&downloaded);
        let fl = Arc::clone(&failed);
        let app_clone = app.clone();
        let task_id = uuid::Uuid::new_v4().to_string();
        
        tokio::spawn(async move {
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
            
            match reqwest::get(&url).await {
                Ok(resp) if resp.status().is_success() => {
                    let total_size = resp.content_length().unwrap_or(0);
                    match resp.bytes().await {
                        Ok(bytes) => {
                            let downloaded_size = bytes.len() as u64;
                            
                            // Create parent directories if they don't exist
                            if let Some(parent) = save_path.parent() {
                                if let Err(e) = fs::create_dir_all(parent) {
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
                                    return;
                                }
                            }
                            
                            match fs::write(&save_path, &bytes) {
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

    for h in handles { let _ = h.await; }

    Ok(DownloadResult {
        downloaded: Arc::try_unwrap(downloaded).unwrap().into_inner().unwrap(),
        failed: Arc::try_unwrap(failed).unwrap().into_inner().unwrap(),
    })
}

#[tauri::command]
async fn download_file(url: String, save_path: String) -> Result<(), String> {
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

#[derive(serde::Serialize)]
struct FileInfo {
    path: String,
    name: String,
    size: u64,
    relative_path: String,
}

#[derive(serde::Serialize)]
struct ScanFolderResult {
    files: Vec<FileInfo>,
    total_size: u64,
    total_count: usize,
}

#[tauri::command]
fn scan_folder(folder_path: String) -> Result<ScanFolderResult, String> {
    let base_path = PathBuf::from(&folder_path);
    if !base_path.is_dir() {
        return Err("Not a directory".to_string());
    }
    
    let mut files = Vec::new();
    let mut total_size = 0u64;
    
    let walker = walkdir::WalkDir::new(&base_path).into_iter().filter_map(|e| e.ok());
    for entry in walker {
        if entry.file_type().is_file() {
            let file_path = entry.path().to_path_buf();
            let size = std::fs::metadata(&file_path)
                .map(|m| m.len())
                .unwrap_or(0);
            
            let relative_path = file_path
                .strip_prefix(base_path.parent().unwrap_or(&base_path))
                .unwrap_or(&file_path)
                .to_string_lossy()
                .replace('\\', "/");
            
            let name = file_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string();
            
            total_size += size;
            files.push(FileInfo {
                path: file_path.to_string_lossy().to_string(),
                name,
                size,
                relative_path,
            });
        }
    }
    
    let total_count = files.len();
    
    Ok(ScanFolderResult {
        files,
        total_size,
        total_count,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![greet, get_histories, get_kodo_histories, save_history, delete_history, upload_files, download_file, download_files_to_dir, scan_folder])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
