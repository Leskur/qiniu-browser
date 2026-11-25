use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use crate::filesystem::collect_files;
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

// A stop request invalidates the generation captured by each active batch.
static UPLOAD_CANCEL_GENERATION: AtomicU64 = AtomicU64::new(0);
const MAX_CONCURRENT_UPLOAD_FILES: usize = 10;
const MAX_CONCURRENT_UPLOAD_PARTS: usize = 5;

#[tauri::command]
pub(crate) fn cancel_uploads() {
    UPLOAD_CANCEL_GENERATION.fetch_add(1, Ordering::SeqCst);
    info!("收到停止全部上传请求");
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
pub(crate) struct UploadResult {
    skipped: Vec<String>,
    uploaded: Vec<String>,
    failed: Vec<String>,
    cancelled: usize,
}

#[tauri::command]
pub(crate) async fn upload_files(
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
