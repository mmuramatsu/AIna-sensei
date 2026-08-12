//! # AIna-sensei Tauri Backend Library
//!
//! This library provides the Rust-side backend interface for the AIna-sensei desktop application.
//! It is responsible for:
//! - Managing application state (cached regional screenshot buffers, scaling factors, hotkeys).
//! - Reading, writing, and loading the JSON config file (`config.json`).
//! - Intercepting and registering global shortcuts using Tauri plugins.
//! - Capturing and cropping regional screenshots on active displays.
//! - Handling inter-window controls (settings window, transparent snipping overlay, and docked HUD panel).
//! - Providing system tray menus and handling close/quit events.

use base64::prelude::*;
use screenshots::image::{DynamicImage, ImageFormat, RgbaImage};
use screenshots::Screen;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Holds the active runtime state shared across the Tauri application contexts.
pub struct AppState {
    /// Cached buffer containing the last captured full-screen image.
    pub last_capture: Mutex<Option<RgbaImage>>,
    /// Active high-DPI scaling factor of the primary display (e.g. 1.0, 1.25, 2.0).
    pub scale_factor: Mutex<f32>,
    /// Registered global keyboard shortcut handle for triggering screen region captures.
    pub capture_shortcut: Mutex<Option<Shortcut>>,
    /// Registered global keyboard shortcut handle for toggling the HUD window visibility.
    pub toggle_shortcut: Mutex<Option<Shortcut>>,
}

/// Configuration bindings for global hotkeys.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HotkeysConfig {
    /// Keyboard shortcut pattern for capturing a region (e.g., `CommandOrControl+Shift+J`).
    pub capture_region: String,
    /// Keyboard shortcut pattern for toggling the HUD panel overlay (e.g., `CommandOrControl+Shift+O`).
    pub toggle_overlay: String,
}

/// Configuration settings for the connected Large Language Model provider.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LlmConfig {
    /// LLM provider engine (e.g., `"ollama"`, `"gemini"`, `"openai"`, `"custom"`, `"deepseek"`).
    pub provider: String,
    /// Optional API key for cloud endpoints (Gemini / OpenAI compatible API keys).
    pub cloud_api_key: String,
    /// Targeted endpoint url for querying (e.g., `"http://localhost:11434"` for Ollama).
    pub endpoint_url: String,
    /// Specified model ID (e.g., `"llama3"`, `"gemini-1.5-flash"`, `"gpt-4o"`).
    pub model: String,
    /// Pre-configured instruction prompt for translating and breaking down Japanese segments.
    pub system_prompt: String,
}

/// Configuration parameters for the Optical Character Recognition engine.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OcrConfig {
    /// Target OCR execution pipeline (e.g., `"cloud_vision"` or `"llm_multimodal"`).
    pub mode: String,
    /// Google Cloud Vision API Key if in `cloud_vision` mode.
    pub api_key: String,
    /// Target recognition/hint language code (defaults to `"ja"`).
    pub target_language: String,
}

/// Interface themes and display configuration rules.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UiConfig {
    /// active UI visual layout style (`"dark"`, `"light"`).
    pub theme: String,
    /// HUD overlay box transparency parameter (0.0 to 1.0).
    pub overlay_opacity: f32,
    /// Sets whether the HUD remains pinned in front of other programs.
    pub always_on_top: bool,
}

/// The parent structure holding all user-configurable parameters of the application.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppConfig {
    /// Global key combinations.
    pub hotkeys: HotkeysConfig,
    /// Connected AI tutor parameters.
    pub llm: LlmConfig,
    /// Text extraction setups.
    pub ocr: OcrConfig,
    /// HUD visual layouts properties.
    pub ui: UiConfig,
    /// Saved LLM configuration presets.
    #[serde(default)]
    pub presets: HashMap<String, LlmConfig>,
}

impl Default for AppConfig {
    /// Generates the standard default configuration parameters for AIna-sensei.
    fn default() -> Self {
        let mut presets = HashMap::new();
        let default_tutor = LlmConfig {
            provider: "ollama".to_string(),
            cloud_api_key: "".to_string(),
            endpoint_url: "http://localhost:11434".to_string(),
            model: "llama3".to_string(),
            system_prompt: "You are a Japanese tutor. Analyze the following OCR text:\n\nText: {extracted_text}\n\nProvide:\n1. The extracted text\n2. Romaji transcription\n3. Natural English Translation\n4. Vocabulary Breakdown with Furigana\n5. Concise Grammar Points.".to_string(),
        };
        presets.insert(
            "Japanese Tutor (Default)".to_string(),
            default_tutor.clone(),
        );

        let translator = LlmConfig {
            provider: "ollama".to_string(),
            cloud_api_key: "".to_string(),
            endpoint_url: "http://localhost:11434".to_string(),
            model: "llama3".to_string(),
            system_prompt: "You are a precise English translator. Translate the following text into natural, clear English:\n\nText: {extracted_text}".to_string(),
        };
        presets.insert("English Translator".to_string(), translator);

        AppConfig {
            hotkeys: HotkeysConfig {
                capture_region: "CommandOrControl+Shift+J".to_string(),
                toggle_overlay: "CommandOrControl+Shift+O".to_string(),
            },
            llm: default_tutor,
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
            presets,
        }
    }
}

/// Resolves the absolute path to the workspace `config.json` file inside the system's AppData directory.
fn get_config_path(app: &AppHandle) -> PathBuf {
    let mut path = app.path().app_config_dir().unwrap_or_default();
    let _ = fs::create_dir_all(&path);
    path.push("config.json");
    path
}

/// Tauri command to load the configuration from disk.
/// If the file does not exist or fails to parse, it writes and returns the default configuration.
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

/// Tauri command to persist custom configuration parameters to the local config file.
/// Triggers global hotkey re-registration inside the Tauri background loop.
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

/// Unregisters all active hotkeys and registers new ones according to the latest configuration.
fn register_hotkeys(app: &AppHandle, config: &AppConfig, state: &AppState) -> Result<(), String> {
    let global_shortcut = app.global_shortcut();
    let _ = global_shortcut.unregister_all();

    // Register capture key
    if let Ok(shortcut) = Shortcut::from_str(&config.hotkeys.capture_region) {
        global_shortcut
            .register(shortcut.clone())
            .map_err(|e| format!("Failed to register capture hotkey: {}", e))?;
        if let Ok(mut cs) = state.capture_shortcut.lock() {
            *cs = Some(shortcut);
        }
    }

    // Register toggle key
    if let Ok(shortcut) = Shortcut::from_str(&config.hotkeys.toggle_overlay) {
        global_shortcut
            .register(shortcut.clone())
            .map_err(|e| format!("Failed to register toggle hotkey: {}", e))?;
        if let Ok(mut ts) = state.toggle_shortcut.lock() {
            *ts = Some(shortcut);
        }
    }

    Ok(())
}

/// Automatically positions the transparent HUD window along the right edge of the primary physical monitor,
/// spanning 1/4th width of the monitor size.
fn position_hud_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if let Some(monitor) = window.primary_monitor().map_err(|e| e.to_string())? {
        let size = monitor.size();
        let pos = monitor.position();

        // 1/4th of monitor width
        let hud_width = (size.width as f64 / 4.0) as u32;
        let hud_height = size.height;

        let x = pos.x + (size.width as i32 - hud_width as i32);
        let y = pos.y;

        window
            .set_size(tauri::PhysicalSize::new(hud_width, hud_height))
            .map_err(|e| e.to_string())?;
        window
            .set_position(tauri::PhysicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Tauri command to programmatically display a window and focus on it.
/// If displaying the HUD overlay, it automatically recalibrates its docking position on the monitor.
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

/// Tauri command to programmatically hide a window by its label identifier.
#[tauri::command]
fn hide_window(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&label) {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Tauri command to write logs into a debug text file stored under the system's Document directory.
#[tauri::command]
fn write_debug_log(app: AppHandle, log: String) {
    if let Ok(mut path) = app.path().document_dir() {
        path.push("AInaSensei");
        let _ = fs::create_dir_all(&path);
        path.push("AInaSensei_debug.log");
        if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
            use std::io::Write;
            let _ = writeln!(file, "{}", log);
        }
    }
}

/// Tauri command to perform a full-screen snapshot of the primary screen monitor,
/// saving the resulting raw pixel buffer to shared state, and returning the base64 data url.
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

/// Tauri command to fetch the last cached full-screen screenshot, encoded as base64 data url.
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

/// Tauri command to crop a smaller sub-region from the cached full-screen image buffer
/// based on logical coordinates (scaled to actual physical monitor DPI scale).
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

/// Triggers a screen region capture loop when the global capture hotkey is pressed.
/// Temporarily hides the HUD window, captures the primary display buffer, and displays the Snipper overlay.
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

/// Toggles the visibility of the docked HUD overlay when the toggle hotkey is pressed.
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

/// Main entry point of the Tauri desktop application.
/// Initializes plugins, hooks window intercept events, builds the tray menu, registers hotkeys, and runs the Tauri builder loop.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
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
                })
                .build(),
        )
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
                    .on_menu_event(|app, event| match event.id().as_ref() {
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
