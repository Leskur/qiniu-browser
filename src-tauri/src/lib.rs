use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

// A stop request invalidates the generation captured by each active batch.
static UPLOAD_CANCEL_GENERATION: AtomicU64 = AtomicU64::new(0);
const MAX_CONCURRENT_UPLOAD_FILES: usize = 10;
const MAX_CONCURRENT_UPLOAD_PARTS: usize = 5;

#[derive(serde::Serialize)]
struct QiniuApiResponse {
    status: u16,
    body: String,
}

// 保留七牛非标准 HTTP 状态码，避免 Web Response 限制丢失业务错误。
#[tauri::command]
async fn qiniu_api_request(
    url: String,
    method: String,
    headers: Vec<(String, String)>,
    body: Option<Vec<u8>>,
) -> Result<QiniuApiResponse, String> {
    let url = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    let host = url.host_str().unwrap_or_default();
    if url.scheme() != "https"
        || !(host.ends_with(".qiniuapi.com") || host == "api.qiniu.com" || host.ends_with(".qiniup.com"))
    {
        return Err("仅支持七牛 API 请求".into());
    }
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    let client = CLIENT.get_or_init(|| reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .expect("Failed to create Qiniu HTTP client"));
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    send_qiniu_api_request(client, method, url, headers, body).await
}

async fn send_qiniu_api_request(
    client: &reqwest::Client,
    method: reqwest::Method,
    url: reqwest::Url,
    headers: Vec<(String, String)>,
    body: Option<Vec<u8>>,
) -> Result<QiniuApiResponse, String> {
    let mut request = client.request(method, url);
    for (name, value) in headers {
        request = request.header(name, value);
    }
    if let Some(body) = body {
        request = request.body(body);
    }
    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let body = response.text().await.map_err(|e| e.to_string())?;
    Ok(QiniuApiResponse { status, body })
}

#[cfg(test)]
mod qiniu_http_tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn preserves_qiniu_614_and_error_body() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            socket.read(&mut request).unwrap();
            let body = r#"{"error":"file exists"}"#;
            write!(socket, "HTTP/1.1 614 File Exists\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
        });
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let response = runtime.block_on(send_qiniu_api_request(
            &reqwest::Client::builder().no_proxy().build().unwrap(),
            reqwest::Method::POST,
            reqwest::Url::parse(&format!("http://{address}/move/source/dest/force/false")).unwrap(),
            vec![],
            None,
        )).unwrap();
        assert_eq!(response.status, 614);
        assert_eq!(response.body, r#"{"error":"file exists"}"#);
        server.join().unwrap();
    }
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn cancel_uploads() {
    UPLOAD_CANCEL_GENERATION.fetch_add(1, Ordering::SeqCst);
    info!("收到停止全部上传请求");
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
fn rename_history(access_key: String, description: String) -> Result<(), String> {
    let description = description.trim();
    if description.is_empty() {
        return Err("账号名称不能为空".into());
    }
    let home_path_str = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Cannot find home directory".to_string())?;
    let history_path = PathBuf::from(home_path_str)
        .join(".qiniu-browser")
        .join("ak_histories.json");

    // 未记住的账号只更新当前会话，不创建登录记录。
    if !history_path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&history_path).map_err(|e| e.to_string())?;
    let mut history: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let items = history.get_mut("historyItems")
        .and_then(|v| v.as_array_mut())
        .ok_or_else(|| "Invalid history format".to_string())?;
    let mut updated = false;
    for item in items {
        if item.get("accessKey").and_then(|v| v.as_str()) == Some(access_key.as_str()) {
            item["description"] = serde_json::Value::String(description.to_string());
            updated = true;
        }
    }
    if updated {
        let content = serde_json::to_string_pretty(&history).map_err(|e| e.to_string())?;
        fs::write(&history_path, content).map_err(|e| e.to_string())?;
    }
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
use qiniu_sdk::http_client::ResponseErrorKind;
use qiniu_sdk::objects::ObjectsManager;
use qiniu_sdk::upload::{
    AutoUploader, AutoUploaderObjectParams, FixedConcurrencyProvider, UploadManager,
    UploadTokenSigner, UploaderWithCallbacks,
};
use std::time::Duration;
use rayon::prelude::*;
use std::sync::Mutex;
use tauri::{Emitter, AppHandle};
use log::{info, error};


fn collect_files(
    paths: Vec<String>,
    prefix: &str,
    relative_paths: Option<Vec<String>>,
) -> Vec<(PathBuf, String)> {
    // 文件夹弹窗已扫出相对路径时，直接用它拼 key，保留目录结构
    if let Some(rels) = relative_paths {
        return paths
            .into_iter()
            .zip(rels)
            .map(|(path_str, rel)| {
                let rel = rel.replace('\\', "/");
                let key = format!("{}{}", prefix, rel);
                (PathBuf::from(path_str), key)
            })
            .collect();
    }

    let mut result = Vec::new();
    for path_str in paths {
        let path = PathBuf::from(&path_str);
        if path.is_dir() {
            let base = path.clone();
            let walker = walkdir::WalkDir::new(&path).into_iter().filter_map(|e| e.ok());
            for entry in walker {
                if entry.file_type().is_file() {
                    let file_path = entry.path().to_path_buf();
                    let rel = file_path
                        .strip_prefix(base.parent().unwrap_or(&base))
                        .unwrap_or(&file_path)
                        .to_string_lossy()
                        .replace('\\', "/");
                    let key = format!("{}{}", prefix, rel);
                    result.push((file_path, key));
                }
            }
        } else {
            let filename = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string();
            let key = format!("{}{}", prefix, filename);
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

#[derive(serde::Serialize)]
struct UploadEntry {
    path: String,
    key: String,
    size: u64,
}

#[tauri::command]
async fn prepare_uploads(
    file_paths: Vec<String>,
    prefix: String,
    relative_paths: Option<Vec<String>>,
) -> Result<Vec<UploadEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        collect_files(file_paths, &prefix, relative_paths)
            .into_iter()
            .map(|(path, key)| UploadEntry {
                size: fs::metadata(&path).map(|metadata| metadata.len()).unwrap_or(0),
                path: path.to_string_lossy().into_owned(),
                key,
            })
            .collect()
    })
    .await
    .map_err(|error| error.to_string())
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
    skipped: Vec<String>,
    uploaded: Vec<String>,
    failed: Vec<String>,
    cancelled: usize,
}

#[tauri::command]
async fn upload_files(
    app: AppHandle,
    ak: String,
    sk: String,
    bucket: String,
    file_paths: Vec<String>,
    prefix: String,
    relative_paths: Option<Vec<String>>,
    conflict_policy: Option<String>,
    task_ids: Option<Vec<String>>,
) -> Result<UploadResult, String> {
    info!("上传开始: bucket={}, prefix={}, files={}", bucket, prefix, file_paths.len());
    let policy = conflict_policy.unwrap_or_else(|| "skip".into());
    if !["skip", "overwrite"].contains(&policy.as_str()) { return Err("无效的同名处理策略".into()); }
    let generation = UPLOAD_CANCEL_GENERATION.load(Ordering::SeqCst);
    let app_clone = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        static UPLOAD_POOL: std::sync::OnceLock<Result<rayon::ThreadPool, rayon::ThreadPoolBuildError>> =
            std::sync::OnceLock::new();
        let pool = UPLOAD_POOL.get_or_init(|| {
            rayon::ThreadPoolBuilder::new()
                .num_threads(MAX_CONCURRENT_UPLOAD_FILES)
                .build()
        }).as_ref().map_err(|error| format!("无法启动上传线程池: {error}"))?;
        let is_cancelled = move || UPLOAD_CANCEL_GENERATION.load(Ordering::SeqCst) != generation;
        let preflight_bucket = (policy == "skip")
            .then(|| ObjectsManager::new(Credential::new(&ak, &sk)).bucket(bucket.clone()));
        let upload_manager = UploadManager::builder(
            UploadTokenSigner::new_credential_provider_builder(
                Credential::new(&ak, &sk),
                &bucket,
                Duration::from_secs(3600),
            ).on_policy_generated({ let overwrite = policy == "overwrite"; move |builder| { if !overwrite { builder.insert_only(); } Ok(()) } }).build()
        ).build();
        let mut uploader_builder = upload_manager.auto_uploader_builder();
        uploader_builder.concurrency_provider(
            FixedConcurrencyProvider::new(MAX_CONCURRENT_UPLOAD_PARTS)
                .expect("Upload part concurrency must be positive"),
        );

        let files = collect_files(file_paths, &prefix, relative_paths);
        let uploaded: Mutex<Vec<String>> = Mutex::new(Vec::new());
        let failed: Mutex<Vec<String>> = Mutex::new(Vec::new());
        let skipped: Mutex<Vec<String>> = Mutex::new(Vec::new());
        let cancelled: Mutex<Vec<String>> = Mutex::new(Vec::new());

        let upload_file = |(index, (path, key)): (usize, &(PathBuf, String))| {
            let task_id = task_ids.as_ref().and_then(|ids| ids.get(index)).cloned().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            if is_cancelled() {
                cancelled.lock().unwrap().push(key.clone());
                let _ = app_clone.emit("upload-progress", UploadProgressEvent {
                    task_id,
                    file_name: key.clone(),
                    file_path: path.to_string_lossy().into_owned(),
                    total_size: 0,
                    uploaded_size: 0,
                    progress: 0.0,
                    status: "cancelled".into(),
                    error: Some("已停止".into()),
                });
                return;
            }

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

            // 发出开始事件后再次检查，避免刚创建的任务继续跑
            if is_cancelled() {
                cancelled.lock().unwrap().push(key.clone());
                let _ = app_clone.emit("upload-progress", UploadProgressEvent {
                    task_id,
                    file_name,
                    file_path,
                    total_size,
                    uploaded_size: 0,
                    progress: 0.0,
                    status: "cancelled".to_string(),
                    error: Some("已停止".to_string()),
                });
                return;
            }

            let mut auto_uploader: AutoUploader = uploader_builder.build();

            // Register progress callback（节流：≥200ms 或进度变化 ≥1%；取消时返回 Err 中断）
            let app_progress = app_clone.clone();
            let task_id_progress = task_id.clone();
            let file_name_progress = file_name.clone();
            let file_path_progress = file_path.clone();
            let last_emit = std::sync::Mutex::new((std::time::Instant::now() - std::time::Duration::from_secs(1), -1.0f64));
            auto_uploader.on_upload_progress(move |info| {
                if is_cancelled() {
                    return Err(std::io::Error::new(std::io::ErrorKind::Interrupted, "upload cancelled").into());
                }
                let uploaded = info.transferred_bytes();
                let total = info.total_bytes().unwrap_or(total_size);
                let progress = if total > 0 { uploaded as f64 / total as f64 * 100.0 } else { 0.0 };
                {
                    let mut guard = last_emit.lock().unwrap();
                    let (ref mut last_at, ref mut last_pct) = *guard;
                    let now = std::time::Instant::now();
                    let due = now.duration_since(*last_at) >= std::time::Duration::from_millis(200)
                        || (progress - *last_pct).abs() >= 1.0
                        || progress >= 100.0;
                    if !due {
                        return Ok(());
                    }
                    *last_at = now;
                    *last_pct = progress;
                }
                let _ = app_progress.emit("upload-progress", UploadProgressEvent {
                    task_id: task_id_progress.clone(),
                    file_name: file_name_progress.clone(),
                    file_path: file_path_progress.clone(),
                    total_size: total,
                    uploaded_size: uploaded,
                    progress,
                    status: "uploading".to_string(),
                    error: None,
                });
                Ok(())
            });
            
            let upload_params = |target: &str| {
                AutoUploaderObjectParams::builder()
                    .object_name(target.to_string())
                    .file_name(target.to_string())
                    .build()
            };
            let target = key.clone();
            let is_conflict = |error: &qiniu_sdk::http_client::ResponseError| {
                matches!(error.kind(), ResponseErrorKind::StatusCodeError(code) if code.as_u16() == 614)
            };
            let upload = |attempt| {
                let result = auto_uploader.upload_path(path, upload_params(&target));
                match &result {
                    Ok(body) => info!(
                        "七牛上传响应: key={:?}, policy={}, attempt={}, result=Ok, body={}",
                        target, policy, attempt, body
                    ),
                    Err(error) => info!(
                        "七牛上传响应: key={:?}, policy={}, attempt={}, result=Err, kind={:?}, error={}",
                        target, policy, attempt, error.kind(), error
                    ),
                }
                result
            };
            let upload_result = (|| {
                if let Some(bucket) = &preflight_bucket {
                    match bucket.stat_object(&target).call() {
                        Ok(_) => return Ok(None),
                        Err(error) if matches!(
                            error.kind(),
                            ResponseErrorKind::StatusCodeError(code) if code.as_u16() == 612
                        ) => {}
                        Err(error) => return Err(format!("同名预检失败: {error}")),
                    }
                }
                if is_cancelled() {
                    return Err("已停止".into());
                }

                let mut result = upload(1);
                if result.as_ref().err().is_some_and(|error| !is_conflict(error)) && !is_cancelled() {
                    result = upload(2);
                }
                if policy == "skip" && result.as_ref().err().is_some_and(is_conflict) {
                    return Ok(None);
                }
                result.map(Some).map_err(|error| error.to_string())
            })();
            if matches!(upload_result, Ok(None)) && !is_cancelled() {
                info!("同名文件已跳过: {}", key);
                skipped.lock().unwrap().push(key.clone());
                let _ = app_clone.emit("upload-progress", UploadProgressEvent { task_id, file_name, file_path, total_size, uploaded_size: 0, progress: 0.0, status: "skipped".into(), error: Some("同名文件已跳过".into()) });
                return;
            }

            match upload_result {
                Ok(Some(_)) => {
                    // 极端情况下完成瞬间才取消，仍记为成功
                    info!("上传成功: {}", key);
                    uploaded.lock().unwrap().push(target.clone());
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
                result => {
                    if is_cancelled() {
                        info!("上传已取消: {}", key);
                        cancelled.lock().unwrap().push(key.clone());
                        let _ = app_clone.emit("upload-progress", UploadProgressEvent {
                            task_id,
                            file_name,
                            file_path,
                            total_size,
                            uploaded_size: 0,
                            progress: 0.0,
                            status: "cancelled".to_string(),
                            error: Some("已停止".to_string()),
                        });
                    } else if let Err(e) = result {
                        error!("上传失败: {} - {}", key, e);
                        let error_msg = format!("{}: {}", key, e);
                        failed.lock().unwrap().push(error_msg.clone());
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
                    }
                },
            }
        };
        pool.install(|| files.par_iter().enumerate().for_each(upload_file));

        let cancelled_count = cancelled.into_inner().unwrap().len();
        if cancelled_count > 0 {
            info!("上传结束（含取消 {} 个）", cancelled_count);
        }

        Ok(UploadResult {
            cancelled: cancelled_count,
            skipped: skipped.into_inner().unwrap(),
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
async fn download_files_to_dir(
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

#[tauri::command]
fn path_is_dir(path: String) -> bool {
    PathBuf::from(path).is_dir()
}

#[tauri::command]
fn classify_paths(paths: Vec<String>) -> Vec<(String, bool)> {
    paths
        .into_iter()
        .map(|p| {
            let is_dir = PathBuf::from(&p).is_dir();
            (p, is_dir)
        })
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                ])
                .build()
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![greet, qiniu_api_request, get_histories, get_kodo_histories, save_history, rename_history, delete_history, prepare_uploads, upload_files, cancel_uploads, download_file, download_files_to_dir, scan_folder, path_is_dir, classify_paths])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
