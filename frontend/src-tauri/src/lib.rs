// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::{
    net::{SocketAddr, TcpStream},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};

use tauri::{Manager, WindowEvent};

struct BackendProcess(Mutex<Option<Child>>);

fn backend_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "video-editor-backend.exe"
    } else {
        "video-editor-backend"
    }
}

fn backend_port_is_open() -> bool {
    let Ok(address) = "127.0.0.1:8000".parse::<SocketAddr>() else {
        return false;
    };

    TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok()
}

fn start_backend(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    if backend_port_is_open() {
        eprintln!("Backend already running on 127.0.0.1:8000; skipping sidecar start.");
        return Ok(());
    }

    let resource_dir = app.path().resource_dir()?;
    let backend_exe = resource_dir.join("backend").join(backend_binary_name());

    if !backend_exe.exists() {
        eprintln!("Backend sidecar not found: {}", backend_exe.display());
        return Ok(());
    }

    let backend_home = app.path().app_local_data_dir()?.join("backend");
    std::fs::create_dir_all(&backend_home)?;

    let mut command = Command::new(&backend_exe);
    command
        .current_dir(backend_exe.parent().unwrap_or(resource_dir.as_path()))
        .env("VIDEO_EDITOR_BACKEND_HOME", backend_home)
        .env("VIDEO_EDITOR_BACKEND_HOST", "127.0.0.1")
        .env("VIDEO_EDITOR_BACKEND_PORT", "8000")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let child = command.spawn()?;
    app.manage(BackendProcess(Mutex::new(Some(child))));

    Ok(())
}

fn stop_backend(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<BackendProcess>() {
        if let Ok(mut child) = state.0.lock() {
            if let Some(mut process) = child.take() {
                let _ = process.kill();
                let _ = process.wait();
            }
        }
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            if let Err(error) = start_backend(app) {
                eprintln!("Failed to start backend sidecar: {error}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::CloseRequested { .. }) {
                stop_backend(&window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
