# Japanese Screen Reader & AI Tutor — Architecture & Project Blueprint

## Executive Summary
This document provides a comprehensive technical blueprint and architectural specification for a desktop application designed to be a multi-purpose AI assistant in reading digital content seamlessly. The application operates quietly in the background, listening for user-defined global hotkeys to initiate an on-demand workflow: capturing a selected screen region, performing Optical Character Recognition (OCR), querying a Large Language Model (LLM) for context breakdown, and displaying an interactive overlay directly over the active workspace.

The project started as software for language learners (specifically Japanese), where you can select any text you see and get context, translation, explanation, etc. However, we realized that this architecture serves as a general-purpose visual AI tutor, and designed it to be fully customizable via configurable prompt definitions.

---

## Key Requirements & Features

1. **Cross-Platform Portability:**
   * Works natively across Windows, macOS, and Linux without OS-specific UI re-architecting.

2. **Single Standalone Executable:**
   * Distributable as a zero-external-dependency installer (`.exe`, `.dmg`, `.AppImage`).
   * No requirement for users to manually run background Python scripts, launch web servers, or install heavy runtimes.

3. **Snipping Tool Workflow (Targeted OCR):**
   * Instant trigger via global keybindings.
   * Free-form regional click-and-drag screen capture to eliminate noise from background UI and speed up processing.

4. **Interactive Configuration Engine (GUI):**
   * Accessible via system tray icon.
   * Switch dynamically between **Local Models** (Ollama, local OpenAI-compatible endpoints) and **Cloud APIs** (Gemini, OpenAI, Anthropic).
   * Fully customizable LLM system prompts and variable substitutions (`{extracted_text}`).
   * Dynamic model population via `/models` API endpoints.

5. **On-Demand Overlay HUD & Hotkey Control:**
   * Non-intrusive floating HUD displaying Furigana, pitch accent hints, grammar breakdowns, and translations.
   * Dual hotkey configuration:
     * **Capture Hotkey:** Triggers region selection tool.
     * **Toggle Hotkey:** Opens/closes/hides the explanation overlay on demand without clearing the active response state.

6. **Interactive Conversational Chat Follow-up:**
   * Users can enter follow-up questions at the bottom of the HUD panel.
   * The system remembers previous conversation turns (extracted OCR text + system prompts + tutor replies) and feeds them to the LLM to sustain active context.
   * Send button aligns to the bottom-right of an auto-resizing text block growing up to 6 lines.

---

## Architectural Breakdown

The system adopts a **4-Layer Desktop Architecture** built inside a unified Tauri workspace:

```
+-----------------------------------------------------------------------------------+
|                                   TAURI APP CONTAINER                             |
|                                                                                   |
|  +------------------------------+             +--------------------------------+  |
|  |     Frontend UI Layer        |             |       Rust Backend Layer       |  |
|  |   (Web View / TypeScript)    |             |       (Core Engine / OS)       |  |
|  |                              |             |                                |  |
|  | * Settings Dashboard         |             | * Global Hotkey Listener       |  |
|  | * Fullscreen Snipper Overlay | <---------> | * Native Screen Capture        |  |
|  | * Floating Explanation HUD   |  IPC Events | * Image Crop & Preprocess      |  |
|  | * Hotkey & State Manager     |             | * Cloud/Local API Orchestrator |  |
|  +------------------------------+             +--------------------------------+  |
+-----------------------------------------------------------------------------------+
```

### Layer 1: Trigger & Global Event Listener
* Managed by Rust using Tauri's global shortcut plugin (`tauri-plugin-global-shortcut`).
* Listens system-wide even when the application is minimized or running in the background.

### Layer 2: Capture & Snipping Tool Engine
* Upon triggering the capture hotkey, Rust grabs a static snapshot of all connected displays into memory.
* Spawns a full-screen transparent Webview window overlaying all monitors.
* User clicks and drags to specify a bounding box $(x, y, \text{width}, \text{height})$.
* Bounding box coordinates are dispatched to Rust via IPC (`invoke`), which crops the original image in memory.

### Layer 3: OCR & Multi-LLM Orchestration
* **OCR Module:** Image payload is routed to either Cloud OCR endpoints (Google Vision API) or bypassed if multimodal direct LLM is selected.
* **LLM Module:** Extracted text is injected into the user's customized system prompt. In addition, the frontend maintains a list of `ChatMessage` turns to support conversational history:
  * **Ollama**: Map turns to `/api/chat` payload.
  * **Gemini**: Map turns to `contents` array with alternating `"user"` and `"model"` roles.
  * **OpenAI / Custom**: Map turns to `/v1/chat/completions` message structures.
  * **Optimized Image Transmission**: The base64 crop is sent *only* on the first turn of the conversation history, and only if OCR fails or direct multimodal is selected, minimizing bandwidth usage on subsequent follow-ups.

### Layer 4: Floating Overlay HUD & Chat
* Renders a frameless, semi-transparent, always-on-top web window over the user's active workspace.
* Holds an in-memory array of conversation messages that auto-scrolls to the bottom.
* Renders a custom styled Markdown feed for assistant replies and block user chat cards.
* Embeds a sticky `<textarea>` input at the bottom designed to auto-grow with scroll limits.

---

## Tech Stack Specification

| Component | Selected Technology | Rationale |
| :--- | :--- | :--- |
| **Framework** | **Tauri v2** | Ultra-lightweight binary (~15–20 MB), low RAM usage, cross-platform compilation. |
| **Core / Engine** | **Rust** | High performance, memory safety, native OS bindings for hotkeys and screen capture. |
| **Frontend UI** | **React & TypeScript** | Rich ecosystem for modern responsive UIs, settings forms, and transparent HUD styling. |
| **Styling** | **Tailwind CSS v4** | Rapid UI development for custom dark-mode themes and floating card components. |
| **Storage / Config** | `tauri-plugin-store` | Persistent local JSON settings stored standard in OS app config directories. |
| **Markdown Compiler** | `react-markdown` | High performance markdown parser mapping inline GFM tables and LaTeX symbols. |

---

## Configuration Schema (JSON Spec)

The application settings are saved to a local config file (e.g., `config.json` in OS app data dir):

```json
{
  "hotkeys": {
    "capture_region": "CommandOrControl+Shift+J",
    "toggle_overlay": "CommandOrControl+Shift+O"
  },
  "llm": {
    "provider": "ollama",
    "cloud_api_key": "",
    "endpoint_url": "http://localhost:11434",
    "model": "llama3",
    "system_prompt": "You are a Japanese tutor. Analyze the following OCR text:\n\nText: {extracted_text}\n\nProvide:\n1. The extracted text\n2. Romaji transcription\n3. Natural English Translation\n4. Vocabulary Breakdown with Furigana\n5. Concise Grammar Points."
  },
  "ocr": {
    "mode": "cloud_vision",
    "api_key": "YOUR_VISION_API_KEY",
    "target_language": "ja"
  },
  "ui": {
    "theme": "dark",
    "overlay_opacity": 0.9,
    "always_on_top": true
  }
}
```
