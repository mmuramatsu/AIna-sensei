// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::str::FromStr;
use std::io::Cursor;
use base64::prelude::*;
use screenshots::image::{RgbaImage, DynamicImage, ImageFormat};
use screenshots::Screen;
use tauri::{AppHandle, Manager, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
};
use serde::{Deserialize, Serialize};

// AppState holds the cached screenshot and current active hotkey shortcuts
pub struct AppState {
    pub last_capture: Mutex<Option<RgbaImage>>,
    pub scale_factor: Mutex<f32>,
    pub capture_shortcut: Mutex<Option<Shortcut>>,
    pub toggle_shortcut: Mutex<Option<Shortcut>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HotkeysConfig {
    pub capture_region: String,
    pub toggle_overlay: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LlmConfig {
    pub provider: String,
    pub cloud_api_key: String,
    pub endpoint_url: String,
    pub model: String,
    pub system_prompt: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OcrConfig {
    pub mode: String,
    pub api_key: String,
    pub target_language: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UiConfig {
    pub theme: String,
    pub overlay_opacity: f32,
    pub always_on_top: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppConfig {
    pub hotkeys: HotkeysConfig,
    pub llm: LlmConfig,
    pub ocr: OcrConfig,
    pub ui: UiConfig,
}

impl Default for AppConfig {
    fn default() -> Self {
        AppConfig {
            hotkeys: HotkeysConfig {
                capture_region: "CommandOrControl+Shift+J".to_string(),
                toggle_overlay: "CommandOrControl+Shift+O".to_string(),
            },
            llm: LlmConfig {
                provider: "ollama".to_string(),
                cloud_api_key: "".to_string(),
                endpoint_url: "http://localhost:11434".to_string(),
                model: "llama3".to_string(),
                system_prompt: "You are a Japanese tutor. Analyze the following OCR text:\n\nText: {extracted_text}\n\nProvide:\n1. Romaji transcription\n2. Natural English Translation\n3. Vocabulary Breakdown with Furigana\n4. Concise Grammar Points.".to_string(),
            },
            ocr: OcrConfig {
                mode: "cloud_vision".to_string(),
                api_key: "YOUR_VISION_API_KEY".to_string(),
                target_language: "ja".to_string(),
            },
            ui: UiConfig {
                theme: "dark".to_string(),
                overlay_opacity: 0.9,
                always_on_top: true,
            },
        }
    }
}

// Config file helper functions
fn get_config_path(app: &AppHandle) -> PathBuf {
    let mut path = app.path().app_config_dir().unwrap_or_default();
    let _ = fs::create_dir_all(&path);
    path.push("config.json");
    path
}

#[tauri::command]
fn load_config(app: AppHandle) -> AppConfig {
    let path = get_config_path(&app);
    if path.exists() {
        if let Ok(content) = fs::read_to_string(path) {
            if let Ok(config) = serde_json::from_str::<AppConfig>(&content) {
                return config;
            }
        }
    }
    let default_config = AppConfig::default();
    let _ = save_config(app, default_config.clone());
    default_config
}

#[tauri::command]
fn save_config(app: AppHandle, config: AppConfig) -> Result<(), String> {
    let path = get_config_path(&app);
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())?;

    // Dynamically re-register hotkeys in the app background thread
    let state = app.state::<AppState>();
    let _ = register_hotkeys(&app, &config, &state);

    Ok(())
}

fn register_hotkeys(app: &AppHandle, config: &AppConfig, state: &AppState) -> Result<(), String> {
    let global_shortcut = app.global_shortcut();
    let _ = global_shortcut.unregister_all();

    // Register capture key
    if let Ok(shortcut) = Shortcut::from_str(&config.hotkeys.capture_region) {
        global_shortcut.register(shortcut.clone())
            .map_err(|e| format!("Failed to register capture hotkey: {}", e))?;
        if let Ok(mut cs) = state.capture_shortcut.lock() {
            *cs = Some(shortcut);
        }
    }

    // Register toggle key
    if let Ok(shortcut) = Shortcut::from_str(&config.hotkeys.toggle_overlay) {
        global_shortcut.register(shortcut.clone())
            .map_err(|e| format!("Failed to register toggle hotkey: {}", e))?;
        if let Ok(mut ts) = state.toggle_shortcut.lock() {
            *ts = Some(shortcut);
        }
    }

    Ok(())
}

// Window commands
fn position_hud_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if let Some(monitor) = window.primary_monitor().map_err(|e| e.to_string())? {
        let size = monitor.size();
        let pos = monitor.position();

        // 1/4th of monitor width
        let hud_width = (size.width as f64 / 4.0) as u32;
        let hud_height = size.height;

        let x = pos.x + (size.width as i32 - hud_width as i32);
        let y = pos.y;

        window.set_size(tauri::PhysicalSize::new(hud_width, hud_height)).map_err(|e| e.to_string())?;
        window.set_position(tauri::PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn show_window(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&label) {
        if label == "hud" {
            let _ = position_hud_window(&window);
        }
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn hide_window(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&label) {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn write_debug_log(app: AppHandle, log: String) {
    if let Ok(mut path) = app.path().document_dir() {
        path.push("AInaSensei");
        let _ = fs::create_dir_all(&path);
        path.push("AInaSensei_debug.log");
        if let Ok(mut file) = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
        {
            use std::io::Write;
            let _ = writeln!(file, "{}", log);
        }
    }
}

// Capture and Cropping Commands
#[tauri::command]
fn capture_screen(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let screens = Screen::all().map_err(|e| format!("Failed to get screens: {}", e))?;
    let primary_screen = screens
        .into_iter()
        .find(|s| s.display_info.is_primary)
        .ok_or_else(|| "No primary screen found".to_string())?;

    let image = primary_screen
        .capture()
        .map_err(|e| format!("Failed to capture screen: {}", e))?;

    let scale_factor = primary_screen.display_info.scale_factor;
    if let Ok(mut sf) = state.scale_factor.lock() {
        *sf = scale_factor;
    }
    if let Ok(mut lc) = state.last_capture.lock() {
        *lc = Some(image.clone());
    }

    // Encode ImageBuffer to PNG bytes
    let mut png_bytes = Vec::new();
    let dynamic_img = DynamicImage::ImageRgba8(image);
    dynamic_img
        .write_to(&mut Cursor::new(&mut png_bytes), ImageFormat::Png)
        .map_err(|e| format!("Failed to encode screen capture: {}", e))?;

    let b64 = BASE64_STANDARD.encode(&png_bytes);
    Ok(format!("data:image/png;base64,{}", b64))
}

#[tauri::command]
fn get_captured_screen(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let last_capture_lock = state.last_capture.lock().unwrap();
    let image = last_capture_lock
        .as_ref()
        .ok_or_else(|| "No screen capture stored".to_string())?;
    
    let mut png_bytes = Vec::new();
    let dynamic_img = DynamicImage::ImageRgba8(image.clone());
    dynamic_img
        .write_to(&mut Cursor::new(&mut png_bytes), ImageFormat::Png)
        .map_err(|e| format!("Failed to encode screen capture: {}", e))?;

    let b64 = BASE64_STANDARD.encode(&png_bytes);
    Ok(format!("data:image/png;base64,{}", b64))
}

#[tauri::command]
fn crop_image(
    state: tauri::State<'_, AppState>,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
) -> Result<String, String> {
    let last_capture_lock = state.last_capture.lock().map_err(|e| e.to_string())?;
    let image = last_capture_lock
        .as_ref()
        .ok_or_else(|| "No screen capture stored".to_string())?;

    let scale = *state.scale_factor.lock().map_err(|e| e.to_string())?;
    
    // Scale logical coordinates to physical coordinates
    let px = (x as f32 * scale) as u32;
    let py = (y as f32 * scale) as u32;
    let pw = (w as f32 * scale) as u32;
    let ph = (h as f32 * scale) as u32;

    let width = image.width();
    let height = image.height();

    // Ensure we don't crop out of bounds
    let px = px.min(width);
    let py = py.min(height);
    let pw = pw.min(width - px);
    let ph = ph.min(height - py);

    if pw == 0 || ph == 0 {
        return Err("Crop area width or height is zero".to_string());
    }

    let dynamic_img = DynamicImage::ImageRgba8(image.clone());
    let cropped_img = dynamic_img.crop_imm(px, py, pw, ph);

    let mut png_bytes = Vec::new();
    cropped_img
        .write_to(&mut Cursor::new(&mut png_bytes), ImageFormat::Png)
        .map_err(|e| format!("Failed to encode cropped image: {}", e))?;

    let b64 = BASE64_STANDARD.encode(&png_bytes);
    Ok(format!("data:image/png;base64,{}", b64))
}

// Hotkey Actions called inside shortcuts thread
fn trigger_capture(app: &AppHandle, state: &AppState) {
    if let Some(hud) = app.get_webview_window("hud") {
        let _ = hud.hide();
    }

    if let Ok(screens) = Screen::all() {
        if let Some(primary_screen) = screens.into_iter().find(|s| s.display_info.is_primary) {
            if let Ok(image) = primary_screen.capture() {
                let scale_factor = primary_screen.display_info.scale_factor;
                if let Ok(mut sf) = state.scale_factor.lock() {
                    *sf = scale_factor;
                }
                if let Ok(mut lc) = state.last_capture.lock() {
                    *lc = Some(image);
                }
                
                if let Some(snipper) = app.get_webview_window("snipper") {
                    let _ = snipper.show();
                    let _ = snipper.set_focus();
                    let _ = snipper.emit("start-snipping", ());
                }
            }
        }
    }
}

fn trigger_toggle_overlay(app: &AppHandle) {
    if let Some(hud) = app.get_webview_window("hud") {
        if let Ok(visible) = hud.is_visible() {
            if visible {
                let _ = hud.hide();
            } else {
                let _ = position_hud_window(&hud);
                let _ = hud.show();
                let _ = hud.set_focus();
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                let state = app.state::<AppState>();
                
                let is_capture = {
                    let guard = state.capture_shortcut.lock().unwrap();
                    guard.as_ref().map(|s| s == shortcut).unwrap_or(false)
                };

                let is_toggle = {
                    let guard = state.toggle_shortcut.lock().unwrap();
                    guard.as_ref().map(|s| s == shortcut).unwrap_or(false)
                };

                if is_capture {
                    trigger_capture(app, &state);
                } else if is_toggle {
                    trigger_toggle_overlay(app);
                }
            }
        }).build())
        .manage(AppState {
            last_capture: Mutex::new(None),
            scale_factor: Mutex::new(1.0),
            capture_shortcut: Mutex::new(None),
            toggle_shortcut: Mutex::new(None),
        })
        .setup(|app| {
            // Setup Tray Icon menu items
            let show_i = MenuItemBuilder::with_id("show_settings", "Open Settings").build(app)?;
            let quit_i = MenuItemBuilder::with_id("quit", "Quit AIna-sensei").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&show_i, &quit_i]).build()?;

            if let Some(icon) = app.default_window_icon() {
                let _tray = TrayIconBuilder::new()
                    .icon(icon.clone())
                    .menu(&menu)
                    .on_menu_event(|app, event| {
                        match event.id().as_ref() {
                            "show_settings" => {
                                if let Some(main_win) = app.get_webview_window("main") {
                                    let _ = main_win.show();
                                    let _ = main_win.set_focus();
                                }
                            }
                            "quit" => {
                                app.exit(0);
                            }
                            _ => {}
                        }
                    })
                    .build(app)?;
            }

            // Load and Register hotkeys
            let state = app.state::<AppState>();
            let config = load_config(app.handle().clone());
            if let Err(e) = register_hotkeys(app.handle(), &config, &state) {
                eprintln!("Error registering hotkeys: {}", e);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            capture_screen,
            get_captured_screen,
            crop_image,
            load_config,
            save_config,
            show_window,
            hide_window,
            write_debug_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
