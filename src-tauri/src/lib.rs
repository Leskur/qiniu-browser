mod accounts;
mod filesystem;
mod qiniu_http;
mod transfers;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
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
        .invoke_handler(tauri::generate_handler![
            greet,
            qiniu_http::qiniu_api_request,
            accounts::get_histories,
            accounts::get_kodo_histories,
            accounts::save_history,
            accounts::rename_history,
            accounts::delete_history,
            filesystem::prepare_uploads,
            filesystem::scan_folder,
            filesystem::path_is_dir,
            filesystem::classify_paths,
            transfers::upload::upload_files,
            transfers::upload::cancel_uploads,
            transfers::download::download_file,
            transfers::download::download_files_to_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
