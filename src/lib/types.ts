/**
 * Configuration schema for global hotkeys combinations.
 */
export interface HotkeysConfig {
  /** Shortcut key for capturing a screen region (e.g. "CommandOrControl+Shift+J") */
  capture_region: string;
  /** Shortcut key for toggling the HUD window visibility (e.g. "CommandOrControl+Shift+O") */
  toggle_overlay: string;
}

/**
 * Configuration settings for the connected Large Language Model backend.
 */
export interface LlmConfig {
  /** The target provider engine (e.g., 'ollama', 'gemini', 'openai') */
  provider: string;
  /** API key for cloud providers (Gemini/OpenAI) */
  cloud_api_key: string;
  /** Connection endpoint URL (e.g. "http://localhost:11434" for Ollama) */
  endpoint_url: string;
  /** Model identifier name (e.g., 'llama3', 'gemini-1.5-flash', 'gpt-4o') */
  model: string;
  /** Default instructions for Japanese tutor translations and grammatical breakdowns */
  system_prompt: string;
}

/**
 * Configuration parameters for the character recognition (OCR) engine.
 */
export interface OcrConfig {
  /** Selected OCR pipeline ('cloud_vision' or 'llm_multimodal') */
  mode: string;
  /** Google Cloud Vision API Key (not required for 'llm_multimodal') */
  api_key: string;
  /** Targeted recognition language code (e.g. 'ja', 'en', 'es', 'zh') */
  target_language: string;
}

/**
 * Configuration for interface themes, opacity, and window pinning attributes.
 */
export interface UiConfig {
  /** Selected visual interface skin (e.g., 'dark' or 'light') */
  theme: string;
  /** Opacity percentage of overlay panels (0.0 to 1.0) */
  overlay_opacity: number;
  /** Pin state (always-on-top) for the overlay HUD window */
  always_on_top: boolean;
}

/**
 * Parent configuration container wrapping all user settings of AIna-sensei.
 */
export interface AppConfig {
  /** Keybind combinations */
  hotkeys: HotkeysConfig;
  /** Connected AI tutor parameters */
  llm: LlmConfig;
  /** Text extraction setups */
  ocr: OcrConfig;
  /** HUD visual layouts properties */
  ui: UiConfig;
}
