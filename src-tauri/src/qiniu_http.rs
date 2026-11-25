#[derive(serde::Serialize)]
pub(crate) struct QiniuApiResponse {
    status: u16,
    body: String,
}

// 保留七牛非标准 HTTP 状态码，避免 Web Response 限制丢失业务错误。
#[tauri::command]
pub(crate) async fn qiniu_api_request(
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
