use super::*;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread::JoinHandle;

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap()
}

fn serve(handler: impl FnOnce(TcpStream) + Send + 'static) -> (String, JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let thread = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        socket
            .set_write_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut request = Vec::new();
        let mut buffer = [0; 1024];
        while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
            let size = socket.read(&mut buffer).unwrap();
            assert!(size > 0 && request.len() < 16 * 1024);
            request.extend_from_slice(&buffer[..size]);
        }
        handler(socket);
    });
    (format!("http://{address}/file"), thread)
}

fn serve_body(body: &'static [u8]) -> (String, JoinHandle<()>) {
    serve(move |mut socket| {
        write!(
            socket,
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .unwrap();
        socket.write_all(body).unwrap();
    })
}

fn directory_names(path: &Path) -> Vec<String> {
    let mut names: Vec<_> = fs::read_dir(path)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[test]
fn download_rejects_paths_outside_the_destination() {
    let root = std::env::temp_dir();
    for name in [
        "../outside.txt",
        "/absolute.txt",
        "nested/../other.txt",
        "nested\\other.txt",
        "file.txt:stream",
    ] {
        assert!(batch_download_path(&root, name).is_err(), "{name}");
    }
}

#[test]
fn streams_before_the_response_finishes_and_only_then_publishes() {
    const BLOCK_SIZE: usize = 64 * 1024;
    const BLOCK_COUNT: usize = 64;
    let directory = tempfile::tempdir().unwrap();
    let target = directory.path().join("large.bin");
    let (continue_sender, continue_receiver) = std::sync::mpsc::channel();
    let (url, server) = serve(move |mut socket| {
        write!(
            socket,
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            BLOCK_SIZE * BLOCK_COUNT
        )
        .unwrap();
        let block = [42; BLOCK_SIZE];
        socket.write_all(&block).unwrap();
        socket.flush().unwrap();
        // Buffering the full response would deadlock here and fail this test.
        continue_receiver
            .recv_timeout(Duration::from_secs(5))
            .unwrap();
        for _ in 1..BLOCK_COUNT {
            socket.write_all(&block).unwrap();
        }
    });
    let mut continue_sender = Some(continue_sender);
    let mut intermediate = false;
    let stats = runtime()
        .block_on(download_to_path(
            &client(),
            &url,
            &target,
            ExistingFilePolicy::Reject,
            |stats| {
                assert!(
                    !target.exists(),
                    "The final path must not expose a partial file"
                );
                if stats.downloaded_size > 0 && stats.downloaded_size < stats.total_size {
                    intermediate = true;
                    if let Some(sender) = continue_sender.take() {
                        sender.send(()).unwrap();
                    }
                }
            },
        ))
        .unwrap();
    server.join().unwrap();
    assert!(intermediate);
    assert_eq!(stats.downloaded_size, (BLOCK_SIZE * BLOCK_COUNT) as u64);
    let bytes = fs::read(&target).unwrap();
    assert_eq!(bytes.len(), BLOCK_SIZE * BLOCK_COUNT);
    assert!(bytes.iter().all(|&byte| byte == 42));
    assert_eq!(directory_names(directory.path()), ["large.bin"]);
}

#[test]
fn interrupted_responses_leave_no_partial_file_and_preserve_existing_files() {
    for policy in [ExistingFilePolicy::Reject, ExistingFilePolicy::Overwrite] {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("file.txt");
        if matches!(policy, ExistingFilePolicy::Overwrite) {
            fs::write(&target, b"original").unwrap();
        }
        let (url, server) = serve(|mut socket| {
            socket
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 1024\r\nConnection: close\r\n\r\npartial",
                )
                .unwrap();
        });
        assert!(runtime()
            .block_on(download_to_path(&client(), &url, &target, policy, |_| {}))
            .is_err());
        server.join().unwrap();
        if matches!(policy, ExistingFilePolicy::Overwrite) {
            assert_eq!(fs::read(&target).unwrap(), b"original");
            assert_eq!(directory_names(directory.path()), ["file.txt"]);
        } else {
            assert!(!target.exists());
            assert!(directory_names(directory.path()).is_empty());
        }
    }
}

#[test]
fn overwrite_replaces_the_existing_file_only_after_success() {
    let directory = tempfile::tempdir().unwrap();
    let target = directory.path().join("file.txt");
    fs::write(&target, b"original").unwrap();
    let (url, server) = serve_body(b"replacement");
    runtime()
        .block_on(download_to_path(
            &client(),
            &url,
            &target,
            ExistingFilePolicy::Overwrite,
            |_| {
                assert_eq!(fs::read(&target).unwrap(), b"original");
            },
        ))
        .unwrap();
    server.join().unwrap();
    assert_eq!(fs::read(&target).unwrap(), b"replacement");
    assert_eq!(directory_names(directory.path()), ["file.txt"]);
}

#[test]
fn download_creates_nested_files_without_overwriting() {
    let directory = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(directory.path()).unwrap();
    let target = batch_download_path(&root, "folder/file.txt").unwrap();
    assert_eq!(target, root.join("folder").join("file.txt"));
    for expected_result in [true, false] {
        let (url, server) = serve_body(b"original");
        let result = runtime().block_on(download_to_path(
            &client(),
            &url,
            &target,
            ExistingFilePolicy::Reject,
            |_| {},
        ));
        server.join().unwrap();
        assert_eq!(result.is_ok(), expected_result);
        if let Err(error) = result {
            assert_eq!(error, "目标文件已存在，未覆盖");
        }
        assert_eq!(fs::read(&target).unwrap(), b"original");
        assert_eq!(directory_names(&root.join("folder")), ["file.txt"]);
    }
}

#[test]
fn a_file_created_during_download_is_not_overwritten() {
    let directory = tempfile::tempdir().unwrap();
    let target = directory.path().join("file.txt");
    let (url, server) = serve_body(b"new download");
    let result = runtime().block_on(download_to_path(
        &client(),
        &url,
        &target,
        ExistingFilePolicy::Reject,
        |stats| {
            if stats.downloaded_size > 0 {
                fs::write(&target, b"created meanwhile").unwrap();
            }
        },
    ));
    server.join().unwrap();
    assert_eq!(result.err().unwrap(), "目标文件已存在，未覆盖");
    assert_eq!(fs::read(&target).unwrap(), b"created meanwhile");
    assert_eq!(directory_names(directory.path()), ["file.txt"]);
}

#[test]
fn chunked_responses_work_without_content_length() {
    let directory = tempfile::tempdir().unwrap();
    let target = directory.path().join("file.txt");
    let (url, server) = serve(|mut socket| {
        socket.write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n").unwrap();
    });
    let stats = runtime()
        .block_on(download_to_path(
            &client(),
            &url,
            &target,
            ExistingFilePolicy::Reject,
            |_| {},
        ))
        .unwrap();
    server.join().unwrap();
    assert_eq!(stats.total_size, 0);
    assert_eq!(stats.downloaded_size, 11);
    assert_eq!(fs::read(&target).unwrap(), b"hello world");
    assert_eq!(directory_names(directory.path()), ["file.txt"]);
}

#[test]
fn http_errors_do_not_create_files() {
    let directory = tempfile::tempdir().unwrap();
    let target = directory.path().join("file.txt");
    let (url, server) = serve(|mut socket| {
        socket
            .write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .unwrap();
    });
    let result = runtime().block_on(download_to_path(
        &client(),
        &url,
        &target,
        ExistingFilePolicy::Reject,
        |_| {},
    ));
    server.join().unwrap();
    assert!(result.err().unwrap().contains("403"));
    assert!(directory_names(directory.path()).is_empty());
}

#[test]
fn publication_failure_removes_the_temporary_file() {
    let directory = tempfile::tempdir().unwrap();
    let target = directory.path().join("existing-directory");
    fs::create_dir(&target).unwrap();
    let (url, server) = serve_body(b"content");
    assert!(runtime()
        .block_on(download_to_path(
            &client(),
            &url,
            &target,
            ExistingFilePolicy::Overwrite,
            |_| {}
        ))
        .is_err());
    server.join().unwrap();
    assert!(target.is_dir());
    assert_eq!(directory_names(directory.path()), ["existing-directory"]);
}
