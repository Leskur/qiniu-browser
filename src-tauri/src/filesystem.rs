use std::fs;
use std::path::PathBuf;

pub(crate) fn collect_files(
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

#[derive(serde::Serialize)]
pub(crate) struct UploadEntry {
    path: String,
    key: String,
    size: u64,
}

#[tauri::command]
pub(crate) async fn prepare_uploads(
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

#[derive(serde::Serialize)]
struct FileInfo {
    path: String,
    name: String,
    size: u64,
    relative_path: String,
}

#[derive(serde::Serialize)]
pub(crate) struct ScanFolderResult {
    files: Vec<FileInfo>,
    total_size: u64,
    total_count: usize,
}

#[tauri::command]
pub(crate) fn scan_folder(folder_path: String) -> Result<ScanFolderResult, String> {
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
pub(crate) fn path_is_dir(path: String) -> bool {
    PathBuf::from(path).is_dir()
}

#[tauri::command]
pub(crate) fn classify_paths(paths: Vec<String>) -> Vec<(String, bool)> {
    paths
        .into_iter()
        .map(|p| {
            let is_dir = PathBuf::from(&p).is_dir();
            (p, is_dir)
        })
        .collect()
}
