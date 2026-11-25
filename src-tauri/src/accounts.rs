use std::fs;
use std::path::PathBuf;

#[tauri::command]
pub(crate) fn get_histories() -> Result<String, String> {
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
pub(crate) fn get_kodo_histories() -> Result<String, String> {
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
pub(crate) struct HistoryItem {
    endpoint_type: String,
    access_key: String,
    access_secret: String,
    remember_me: bool,
    description: String,
}

#[tauri::command]
pub(crate) fn save_history(new_item: HistoryItem) -> Result<(), String> {
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
pub(crate) fn rename_history(access_key: String, description: String) -> Result<(), String> {
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
pub(crate) fn delete_history(access_key: String) -> Result<(), String> {
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
