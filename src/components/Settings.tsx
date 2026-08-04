import { useEffect, useState, FormEvent, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { AppConfig } from "../lib/types";

interface HotkeyRecorderProps {
  onChange: (newValue: string) => void;
  onRecordingChange?: (recording: boolean) => void;
}

function HotkeyRecorder({ onChange, onRecordingChange }: HotkeyRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);

  useEffect(() => {
    onRecordingChange?.(isRecording);
  }, [isRecording, onRecordingChange]);

  useEffect(() => {
    if (!isRecording) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // If the user just pressed escape to cancel recording
      if (e.key === "Escape") {
        setIsRecording(false);
        return;
      }

      // Ignore modifier keys as the final key
      const isModifier = ["Control", "Shift", "Alt", "Meta", "CapsLock"].includes(e.key);
      if (isModifier) return;

      // Enforce at least one modifier key is pressed
      const hasModifier = e.ctrlKey || e.metaKey || e.altKey || e.shiftKey;
      if (!hasModifier) return;

      const parts: string[] = [];

      // Detect modifiers
      if (e.ctrlKey || e.metaKey) {
        parts.push("CommandOrControl");
      }
      if (e.altKey) {
        parts.push("Alt");
      }
      if (e.shiftKey) {
        parts.push("Shift");
      }

      // Map key code nicely (e.g. KeyJ -> J, Digit1 -> 1, F10 -> F10)
      let keyName = e.key;
      
      // Normalize letters to uppercase
      if (keyName.length === 1) {
        keyName = keyName.toUpperCase();
      }

      // Map arrow keys and special keys nicely for Tauri
      if (keyName === "ArrowUp") keyName = "Up";
      if (keyName === "ArrowDown") keyName = "Down";
      if (keyName === "ArrowLeft") keyName = "Left";
      if (keyName === "ArrowRight") keyName = "Right";
      if (keyName === " ") keyName = "Space";

      parts.push(keyName);

      const hotkeyStr = parts.join("+");
      onChange(hotkeyStr);
      setIsRecording(false);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isRecording, onChange]);

  return (
    <button
      type="button"
      onClick={() => setIsRecording(!isRecording)}
      className={`px-3 py-2 rounded-xl border text-xs font-semibold tracking-wide transition-all shadow-md select-none min-w-[120px] active:scale-95 cursor-pointer ${
        isRecording
          ? "bg-red-500/20 border-red-500/40 text-red-400 animate-pulse"
          : "bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20"
      }`}
    >
      {isRecording ? "Press key..." : "Record Key"}
    </button>
  );
}

export function Settings() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [recordingField, setRecordingField] = useState<'capture' | 'toggle' | null>(null);

  const handleCaptureRecordingChange = useCallback((recording: boolean) => {
    setRecordingField(recording ? 'capture' : null);
  }, []);

  const handleToggleRecordingChange = useCallback((recording: boolean) => {
    setRecordingField(recording ? 'toggle' : null);
  }, []);

  // Block default browser shortcuts (Ctrl+P, Ctrl+S, Ctrl+F, etc.) globally in Settings window
  useEffect(() => {
    const blockBrowserShortcuts = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;
      if (isCtrl) {
        const key = e.key.toLowerCase();
        if (["p", "s", "f", "g", "h", "o", "n"].includes(key)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };
    window.addEventListener("keydown", blockBrowserShortcuts, true);
    return () => {
      window.removeEventListener("keydown", blockBrowserShortcuts, true);
    };
  }, []);

  // Fetch configuration on mount
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const loadedConfig = await invoke<AppConfig>("load_config");
        setConfig(loadedConfig);
      } catch (err) {
        console.error("Failed to load config in Settings:", err);
        setErrorMsg("Failed to load configuration files.");
      }
    };
    fetchConfig();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!config) return;

    setSaving(true);
    setSuccessMsg(null);
    setErrorMsg(null);

    try {
      await invoke("save_config", { config });
      setSuccessMsg("Configuration saved and hotkeys re-registered successfully!");
      await emit("config-updated");
      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      console.error("Failed to save config:", err);
      setErrorMsg(err.message || "Failed to save configuration. Verify hotkey shortcuts.");
    } finally {
      setSaving(false);
    }
  };

  const updateConfigField = (section: keyof AppConfig, field: string, value: any) => {
    if (!config) return;
    setConfig({
      ...config,
      [section]: {
        ...config[section],
        [field]: value,
      },
    });
  };

  // Test regional capture shortcut directly
  const testCapture = async () => {
    try {
      await invoke("show_window", { label: "snipper" });
      await invoke("hide_window", { label: "main" }); // Minimize settings to avoid cropping it
    } catch (err) {
      console.error("Failed to test capture:", err);
    }
  };

  if (!config) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-slate-950 text-white">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-white/50 mt-3 animate-pulse">Initializing AIna-sensei Settings...</p>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen bg-slate-950 text-white overflow-y-auto px-6 py-6 custom-scrollbar select-none">
      {/* Header */}
      <header className="flex justify-between items-center pb-5 border-b border-white/10 mb-6">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
            AIna-sensei
          </h1>
          <p className="text-xs text-white/40 mt-1">Your visual AI tutor & assistant overlay. Configure hotkeys and LLM providers.</p>
        </div>
        <button
          onClick={testCapture}
          className="bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 px-3.5 py-1.5 rounded-xl text-xs font-semibold tracking-wide transition-all shadow-md active:scale-95"
        >
          Test Snipper
        </button>
      </header>

      {/* Settings Form */}
      <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl pb-10">
        
        {/* Status Alerts */}
        {successMsg && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-emerald-400 text-xs flex gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{successMsg}</span>
          </div>
        )}
        {errorMsg && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-red-400 text-xs flex gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{errorMsg}</span>
          </div>
        )}

        {/* 1. Global Hotkeys Grid */}
        <section className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4 backdrop-blur shadow-sm">
          <div className="flex items-center gap-2 pb-2 border-b border-white/5">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            <h3 className="text-sm font-bold tracking-wide uppercase text-white/80">Global hotkeys</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-white/50 mb-1.5">Capture Region (Snipper)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={config.hotkeys.capture_region}
                  readOnly
                  placeholder="CommandOrControl+Shift+J"
                  className="flex-1 bg-black/40 border border-white/15 focus:outline-none rounded-xl px-3 py-2 text-sm font-mono text-white/70 select-all cursor-default"
                  required
                />
                <HotkeyRecorder
                  onChange={(val) => updateConfigField("hotkeys", "capture_region", val)}
                  onRecordingChange={handleCaptureRecordingChange}
                />
              </div>
              {recordingField === 'capture' ? (
                <span className="text-[10px] text-amber-400 mt-1 block font-semibold animate-pulse">
                  ⚠️ Hold at least one modifier key (Ctrl, Alt, Shift, or Cmd) + press another key.
                </span>
              ) : (
                <span className="text-[10px] text-white/30 mt-1 block">Cross-platform format. E.g., ctrl+shift+j or cmd+shift+j</span>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-white/50 mb-1.5">Toggle Explanation HUD</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={config.hotkeys.toggle_overlay}
                  readOnly
                  placeholder="CommandOrControl+Shift+O"
                  className="flex-1 bg-black/40 border border-white/15 focus:outline-none rounded-xl px-3 py-2 text-sm font-mono text-white/70 select-all cursor-default"
                  required
                />
                <HotkeyRecorder
                  onChange={(val) => updateConfigField("hotkeys", "toggle_overlay", val)}
                  onRecordingChange={handleToggleRecordingChange}
                />
              </div>
              {recordingField === 'toggle' ? (
                <span className="text-[10px] text-amber-400 mt-1 block font-semibold animate-pulse">
                  ⚠️ Hold at least one modifier key (Ctrl, Alt, Shift, or Cmd) + press another key.
                </span>
              ) : (
                <span className="text-[10px] text-white/30 mt-1 block">Show or hide tutor HUD without resetting state.</span>
              )}
            </div>
          </div>
        </section>

        {/* 2. OCR Configuration */}
        <section className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4 backdrop-blur shadow-sm">
          <div className="flex items-center gap-2 pb-2 border-b border-white/5">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h3 className="text-sm font-bold tracking-wide uppercase text-white/80">OCR (Character Recognition)</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-white/50 mb-1.5">OCR Mode</label>
              <select
                value={config.ocr.mode}
                onChange={(e) => updateConfigField("ocr", "mode", e.target.value)}
                className="w-full bg-black/40 border border-white/15 focus:border-blue-500 rounded-xl px-3 py-2.5 text-sm text-white outline-none transition-all cursor-pointer"
              >
                <option value="cloud_vision">Google Cloud Vision API (Cloud)</option>
                <option value="llm_multimodal">Direct LLM Multimodal (No OCR Key)</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-white/50 mb-1.5">OCR Cloud API Key</label>
              <input
                type="password"
                value={config.ocr.api_key}
                onChange={(e) => updateConfigField("ocr", "api_key", e.target.value)}
                disabled={config.ocr.mode === "llm_multimodal"}
                placeholder={config.ocr.mode === "llm_multimodal" ? "Not required in Multimodal mode" : "Google Vision API Key..."}
                className="w-full bg-black/40 border border-white/15 focus:border-blue-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl px-3 py-2 text-sm text-white outline-none transition-all"
              />
            </div>
          </div>
        </section>

        {/* 3. LLM Configuration */}
        <section className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4 backdrop-blur shadow-sm">
          <div className="flex items-center gap-2 pb-2 border-b border-white/5">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <h3 className="text-sm font-bold tracking-wide uppercase text-white/80">Language Model (Tutor Backend)</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-white/50 mb-1.5">Provider</label>
              <select
                value={config.llm.provider}
                onChange={(e) => updateConfigField("llm", "provider", e.target.value)}
                className="w-full bg-black/40 border border-white/15 focus:border-blue-500 rounded-xl px-3 py-2.5 text-sm text-white outline-none transition-all cursor-pointer"
              >
                <option value="ollama">Ollama (Local)</option>
                <option value="gemini">Google Gemini (Cloud)</option>
                <option value="openai">OpenAI (Cloud)</option>
                <option value="custom">Custom OpenAI-Compatible</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-white/50 mb-1.5">Model Identifier Name</label>
              <input
                type="text"
                value={config.llm.model}
                onChange={(e) => updateConfigField("llm", "model", e.target.value)}
                placeholder="e.g. llama3, gemini-1.5-flash, gpt-4o"
                className="w-full bg-black/40 border border-white/15 focus:border-blue-500 rounded-xl px-3 py-2 text-sm text-white outline-none transition-all"
                required
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-white/50 mb-1.5">API Endpoint URL</label>
              <input
                type="text"
                value={config.llm.endpoint_url}
                onChange={(e) => updateConfigField("llm", "endpoint_url", e.target.value)}
                placeholder="e.g., http://localhost:11434"
                className="w-full bg-black/40 border border-white/15 focus:border-blue-500 rounded-xl px-3 py-2 text-sm text-white outline-none transition-all"
              />
              <span className="text-[10px] text-white/30 mt-1 block">Leave empty for official cloud providers (Gemini/OpenAI defaults)</span>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-white/50 mb-1.5">Provider Cloud API Key</label>
              <input
                type="password"
                value={config.llm.cloud_api_key}
                onChange={(e) => updateConfigField("llm", "cloud_api_key", e.target.value)}
                disabled={config.llm.provider === "ollama"}
                placeholder={config.llm.provider === "ollama" ? "Not required for Local Ollama" : "Enter API Key..."}
                className="w-full bg-black/40 border border-white/15 focus:border-blue-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl px-3 py-2 text-sm text-white outline-none transition-all"
              />
            </div>
            <div className="md:col-span-2">
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-xs font-semibold text-white/50">Tutor System Prompt</label>
                <span className="text-[10px] bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded">
                  Use {"{extracted_text}"} for substitutions
                </span>
              </div>
              <textarea
                value={config.llm.system_prompt}
                onChange={(e) => updateConfigField("llm", "system_prompt", e.target.value)}
                rows={5}
                className="w-full bg-black/40 border border-white/15 focus:border-blue-500 rounded-xl px-3 py-2.5 text-xs text-white outline-none transition-all resize-none font-mono"
                required
              />
            </div>
          </div>
        </section>

        {/* 4. UI styling options */}
        <section className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4 backdrop-blur shadow-sm">
          <div className="flex items-center gap-2 pb-2 border-b border-white/5">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
            </svg>
            <h3 className="text-sm font-bold tracking-wide uppercase text-white/80">UI settings</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center justify-between bg-black/20 border border-white/5 p-3 rounded-xl">
              <div>
                <label className="block text-xs font-semibold text-white/80">Always on Top</label>
                <span className="text-[10px] text-white/30 block mt-0.5">Keep Explanation HUD overlay floating on top.</span>
              </div>
              <input
                type="checkbox"
                checked={config.ui.always_on_top}
                onChange={(e) => updateConfigField("ui", "always_on_top", e.target.checked)}
                className="w-4 h-4 rounded text-blue-500 border-white/10 bg-black/40 focus:ring-blue-500 cursor-pointer"
              />
            </div>
            
            <div className="flex items-center justify-between bg-black/20 border border-white/5 p-3 rounded-xl">
              <div className="flex-1 mr-4">
                <label className="block text-xs font-semibold text-white/80">Overlay Opacity</label>
                <span className="text-[10px] text-white/30 block mt-0.5">Background transparency of tutor HUD overlay.</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0.5"
                  max="1.0"
                  step="0.05"
                  value={config.ui.overlay_opacity}
                  onChange={(e) => updateConfigField("ui", "overlay_opacity", parseFloat(e.target.value))}
                  className="w-24 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
                <span className="text-xs font-mono w-8 text-right">{Math.round(config.ui.overlay_opacity * 100)}%</span>
              </div>
            </div>
          </div>
        </section>

        {/* Action Controls */}
        <div className="flex justify-end gap-3 pt-4">
          <button
            type="submit"
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider px-6 py-3 rounded-xl transition-all shadow-lg shadow-blue-500/10 active:scale-95 cursor-pointer"
          >
            {saving ? "Saving settings..." : "Save changes"}
          </button>
        </div>

      </form>
    </div>
  );
}
