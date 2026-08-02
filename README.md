# AIna-sensei — Your Desktop Visual AI Tutor & Assistant

AIna-sensei is a cross-platform desktop application designed to act as an on-demand visual tutor and assistant. By combining global hotkeys, regional screen capture (OCR), and Large Language Models (LLMs), AIna-sensei provides instant context-aware explanations, translations, vocabulary cards, and grammar breakdowns directly overlaying your active workspace.

Though initialized with a Japanese language focus, AIna-sensei is fully general-purpose: the tutor's personality and instructions depend entirely on the customizable system prompt you define in the settings.

---

## 🌟 Key Features

*   **Snipping Tool Workflow (Targeted OCR):** Trigger regional click-and-drag screen selection instantly using a system-wide hotkey. High-performance SVG masking isolates your selection with zero desktop lag.
*   **On-Demand Explanation HUD:** Renders a frameless, semi-transparent, glassmorphic HUD card directly over your active workspace. Features resizability, collapsible blocks, text copying, and an "Always on Top" pin.
*   **Real-time Streaming Responses:** Streams explanations from local or cloud models, parsing headers, lists, bullet points, and highlight terms in real-time.
*   **Multi-Provider LLM Integration:** Dynamically switches between:
    *   **Local Models:** Ollama, LM Studio, or local OpenAI-compatible endpoints.
    *   **Cloud APIs:** Google Gemini (AI Studio), OpenAI, or Anthropic.
*   **Direct Multimodal Fallback:** If you do not have a Cloud Vision OCR API Key, AIna-sensei can send the cropped image directly to multimodal models (like `gemini-1.5-flash` or `minicpm-v` in LM Studio) for native visual transcribing and breakdown.
*   **Interactive Configuration GUI:** Accessible at any time via the system tray icon to customize providers, API keys, models, themes, and system prompt templates.

---

## 🛠️ Tech Stack

| Component | Selected Technology | Rationale |
| :--- | :--- | :--- |
| **Framework** | **Tauri v2** | Ultra-lightweight binary (~15–20 MB), low RAM usage, cross-platform compilation. |
| **Backend Core** | **Rust** | High performance, memory-safe OS bindings for screenshots, global shortcuts, and tray icons. |
| **Frontend UI** | **React & TypeScript** | Rich component ecosystem for modern state coordination and user dashboards. |
| **Styling** | **Tailwind CSS v4** | Instant utility design for glassmorphic elements and dark mode. |
| **Storage / Config** | **Native Filesystem** | Persistent JSON config files stored standard in OS app config directories. |

---

## 🚀 Getting Started

### Prerequisites
*   [Node.js](https://nodejs.org/) (v18+ recommended)
*   [Rust & Cargo Toolchain](https://www.rust-lang.org/tools/install)
*   An active LLM backend (either a local instance like [LM Studio](https://lmstudio.ai/) / [Ollama](https://ollama.com/), or cloud credentials for Google AI Studio / OpenAI).

### Installation & Run

1.  **Clone the workspace directory:**
    ```bash
    git clone https://github.com/your-username/aina-sensei.git
    cd aina-sensei
    ```

2.  **Install frontend dependencies:**
    ```bash
    npm install
    ```

3.  **Launch the app in development mode:**
    ```bash
    npm run tauri dev
    ```
    *Tauri will download Rust dependencies, compile the backend library, and open the Settings Dashboard window.*

4.  **Build standalone installer (Production):**
    ```bash
    npm run tauri build
    ```
    *Executables and installers (`.exe` on Windows, `.dmg` on macOS, `.deb` on Linux) will be generated inside `src-tauri/target/release/bundle/`.*

---

## ⚙️ Configuration Schema

Settings are saved locally inside a standard app data directory (e.g. `AppData/Roaming/com.aina.sensei/config.json` on Windows):

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
    "system_prompt": "You are a Japanese tutor. Analyze the following OCR text:\n\nText: {extracted_text}\n\nProvide:\n1. Romaji transcription\n2. Natural English Translation\n3. Vocabulary Breakdown with Furigana\n4. Concise Grammar Points."
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

---

## Contributing

Contributions are welcome! If you have any ideas, suggestions, or bug reports, please open an issue or submit a pull request. For major changes, please open an issue first to discuss what you would like to change.

## Contact

If you have any questions, suggestions, or just want to connect, feel free to reach out:

*   **Webpage:** [mmuramatsu.com](https://mmuramatsu.com/)
*   **GitHub:** [@mmuramatsu](https://github.com/mmuramatsu)
*   **Email:** [junior_muramatsu@hotmail.com](mailto:junior_muramatsu@hotmail.com)
*   **LinkedIn:** [Mario Muramatsu Júnior](https://www.linkedin.com/in/mario-muramatsu-jr/)

---

## 📜 License

This project is open-source. See the [LICENSE](LICENSE) file for more details.
