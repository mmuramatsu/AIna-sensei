export interface HotkeysConfig {
  capture_region: string;
  toggle_overlay: string;
}

export interface LlmConfig {
  provider: string;
  cloud_api_key: string;
  endpoint_url: string;
  model: string;
  system_prompt: string;
}

export interface OcrConfig {
  mode: string;
  api_key: string;
  target_language: string;
}

export interface UiConfig {
  theme: string;
  overlay_opacity: number;
  always_on_top: boolean;
}

export interface AppConfig {
  hotkeys: HotkeysConfig;
  llm: LlmConfig;
  ocr: OcrConfig;
  ui: UiConfig;
}
