import { useEffect, useState, FormEvent, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { AppConfig } from "../lib/types";
import { fetchAvailableModels } from "../services/api";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
  const [originalConfig, setOriginalConfig] = useState<AppConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [recordingField, setRecordingField] = useState<'capture' | 'toggle' | null>(null);
  const [activeTab, setActiveTab] = useState<'general' | 'ai' | 'ocr' | 'ui'>('general');

  const [selectedPresetName, setSelectedPresetName] = useState("");
  const [newPresetName, setNewPresetName] = useState("");

  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState("");
  const [updateNotes, setUpdateNotes] = useState("");
  const [updateObject, setUpdateObject] = useState<any>(null);
  const [isDownloadingUpdate, setIsDownloadingUpdate] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadProgressText, setDownloadProgressText] = useState("");
  const [dismissUpdate, setDismissUpdate] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [currentVersion, setCurrentVersion] = useState("");

  const checkAppUpdate = async () => {
    try {
      const updateResult = await check();
      if (updateResult?.available) {
        setUpdateObject(updateResult);
        setUpdateVersion(updateResult.version);
        setUpdateNotes(updateResult.body || "");
        setUpdateAvailable(true);
      }
    } catch (err) {
      console.error("Error checking for updates:", err);
    }
  };

  const handleInstallUpdate = async () => {
    if (!updateObject) return;
    try {
      setUpdateError("");
      setIsDownloadingUpdate(true);
      setDownloadProgress(0);
      setDownloadProgressText("Initializing download...");

      let downloaded = 0;
      let total = 0;

      await updateObject.downloadAndInstall((event: any) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength || 0;
            setDownloadProgressText(`Downloading...`);
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (total > 0) {
              const pct = Math.round((downloaded / total) * 100);
              setDownloadProgress(pct);
              setDownloadProgressText(`Downloading: ${pct}% (${(downloaded / (1024 * 1024)).toFixed(1)} MB / ${(total / (1024 * 1024)).toFixed(1)} MB)`);
            } else {
              setDownloadProgressText(`Downloading: ${(downloaded / (1024 * 1024)).toFixed(1)} MB`);
            }
            break;
          case "Finished":
            setDownloadProgress(100);
            setDownloadProgressText("Installing update and restarting...");
            break;
        }
      });

      await relaunch();
    } catch (err) {
      console.error("Failed to install update:", err);
      setUpdateError("Failed to install update. Signature verification failed.");
      setIsDownloadingUpdate(false);
    }
  };

  useEffect(() => {
    checkAppUpdate();
    const loadVersion = async () => {
      try {
        const ver = await getVersion();
        setCurrentVersion(ver);
      } catch (err) {
        console.error("Failed to load app version:", err);
      }
    };
    loadVersion();
  }, []);

  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [showAllOptions, setShowAllOptions] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const getFilteredModels = () => {
    if (!config?.llm) return [];
    return showAllOptions
      ? fetchedModels
      : fetchedModels.filter(m => m.toLowerCase().includes(config.llm.model.toLowerCase()));
  };

  const [isPresetDropdownOpen, setIsPresetDropdownOpen] = useState(false);
  const [isProviderDropdownOpen, setIsProviderDropdownOpen] = useState(false);
  const [isUrlDropdownOpen, setIsUrlDropdownOpen] = useState(false);
  const [showAllUrls, setShowAllUrls] = useState(false);
  const [urlFocusedIndex, setUrlFocusedIndex] = useState(-1);

  const getFilteredUrls = () => {
    if (!config?.llm) return [];
    const allSuggestions: string[] = [];
    const prov = config.llm.provider;
    if (prov === "ollama") {
      allSuggestions.push("http://localhost:11434", "http://127.0.0.1:11434");
    } else if (prov === "gemini") {
      allSuggestions.push("https://generativelanguage.googleapis.com");
    } else if (prov === "openai") {
      allSuggestions.push("https://api.openai.com");
    } else if (prov === "custom") {
      allSuggestions.push("http://localhost:1234", "http://localhost:8080", "http://localhost:8000");
    }

    return showAllUrls
      ? allSuggestions
      : allSuggestions.filter(u => u.toLowerCase().includes(config.llm.endpoint_url.toLowerCase()));
  };

  useEffect(() => {
    if (!config?.llm) return;

    let active = true;
    const loadModels = async () => {
      setFetchingModels(true);
      try {
        const models = await fetchAvailableModels(config.llm);
        if (active) {
          setFetchedModels(models);
        }
      } catch (e) {
        if (active) {
          setFetchedModels([]);
        }
      } finally {
        if (active) {
          setFetchingModels(false);
        }
      }
    };

    // Debounce to prevent multiple API requests while typing credentials/URL
    const timer = setTimeout(loadModels, 600);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [config?.llm.provider, config?.llm.endpoint_url, config?.llm.cloud_api_key]);

  /**
   * Loads a saved configuration preset into the active LLM backend form fields.
   *
   * @param name - The name of the preset profile to load.
   */
  const handleLoadPreset = (name: string) => {
    setSelectedPresetName(name);
    if (!name || !config) return;
    const preset = (config.presets || {})[name];
    if (preset) {
      setConfig({
        ...config,
        llm: { ...preset }
      });
    }
  };

  /**
   * Saves the current LLM configuration fields under a new or existing preset profile name.
   */
  const handleSavePreset = () => {
    const name = newPresetName.trim();
    if (!name || !config) return;
    const updatedPresets = {
      ...(config.presets || {}),
      [name]: { ...config.llm }
    };
    setConfig({
      ...config,
      presets: updatedPresets
    });
    setSelectedPresetName(name);
    setNewPresetName("");
  };

  /**
   * Deletes the currently selected custom configuration preset.
   */
  const handleDeletePreset = () => {
    if (!selectedPresetName || !config) return;
    const updatedPresets = { ...(config.presets || {}) };
    delete updatedPresets[selectedPresetName];
    setConfig({
      ...config,
      presets: updatedPresets
    });
    setSelectedPresetName("");
  };

  /**
   * Sets default URL endpoints and model names automatically when changing the LLM provider.
   *
   * @param newProvider - The new target provider identifier.
   */
  const handleProviderChange = (newProvider: string) => {
    if (!config) return;

    let defaultEndpoint = "";
    let defaultModel = "";

    if (newProvider === "ollama") {
      defaultEndpoint = "http://localhost:11434";
      defaultModel = "llama3";
    } else if (newProvider === "gemini") {
      defaultEndpoint = "https://generativelanguage.googleapis.com";
      defaultModel = "gemini-1.5-flash";
    } else if (newProvider === "openai") {
      defaultEndpoint = "https://api.openai.com";
      defaultModel = "gpt-4o-mini";
    } else if (newProvider === "custom") {
      defaultEndpoint = "http://localhost:1234";
      defaultModel = "local-model";
    }

    setConfig({
      ...config,
      llm: {
        ...config.llm,
        provider: newProvider,
        endpoint_url: defaultEndpoint,
        model: defaultModel,
      }
    });
    setSelectedPresetName("");
  };

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
        setOriginalConfig(loadedConfig);
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
      setOriginalConfig(config);
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

  const hasUnsavedChanges = config && originalConfig && JSON.stringify(config) !== JSON.stringify(originalConfig);

  if (!config) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-slate-950 text-white">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-white/50 mt-3 animate-pulse">Initializing AIna-sensei Settings...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen bg-slate-950 text-white overflow-hidden select-none font-sans">
      {/* Sidebar Navigation */}
      <aside className="w-64 bg-slate-900/40 border-r border-white/10 flex flex-col justify-between p-5 flex-shrink-0 backdrop-blur-xl">
        <div className="space-y-6">
          {/* Logo / Header */}
          <div className="pb-4 border-b border-white/5">
            <h1 className="text-lg font-black tracking-tight bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent uppercase">
              AIna-sensei
            </h1>
            <p className="text-[10px] text-white/40 mt-0.5">Desktop Visual AI Tutor</p>
          </div>

          {/* Navigation Menu */}
          <nav className="space-y-1.5">
            <button
              type="button"
              onClick={() => setActiveTab("general")}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all border cursor-pointer ${
                activeTab === "general"
                  ? "bg-indigo-500/10 border-indigo-500/20 text-indigo-400"
                  : "bg-transparent border-transparent text-white/50 hover:bg-white/5 hover:text-white"
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
              Global Hotkeys
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("ocr")}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all border cursor-pointer ${
                activeTab === "ocr"
                  ? "bg-indigo-500/10 border-indigo-500/20 text-indigo-400"
                  : "bg-transparent border-transparent text-white/50 hover:bg-white/5 hover:text-white"
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              OCR / Vision
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("ai")}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all border cursor-pointer ${
                activeTab === "ai"
                  ? "bg-indigo-500/10 border-indigo-500/20 text-indigo-400"
                  : "bg-transparent border-transparent text-white/50 hover:bg-white/5 hover:text-white"
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              AI Tutor Backend
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("ui")}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all border cursor-pointer ${
                activeTab === "ui"
                  ? "bg-indigo-500/10 border-indigo-500/20 text-indigo-400"
                  : "bg-transparent border-transparent text-white/50 hover:bg-white/5 hover:text-white"
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
              </svg>
              HUD Interface
            </button>
          </nav>
        </div>

        {/* Sidebar Footer: Save Button & Test button */}
        <div className="space-y-3 pt-4 border-t border-white/5">
          <button
            type="button"
            onClick={testCapture}
            className="w-full bg-white/5 hover:bg-white/10 text-white/80 border border-white/10 px-3.5 py-2 rounded-xl text-xs font-bold tracking-wide transition-all shadow-sm active:scale-95 cursor-pointer flex items-center justify-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            Test Snipper
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider py-3 rounded-xl transition-all shadow-lg shadow-blue-500/10 active:scale-95 cursor-pointer"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>

            {hasUnsavedChanges && (
              <div 
                className="relative group flex items-center justify-center w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 cursor-help flex-shrink-0"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                {/* Custom Tooltip */}
                <div className="absolute bottom-full right-0 mb-2 w-48 hidden group-hover:block bg-slate-900 border border-white/10 text-white text-[10px] p-2.5 rounded-lg shadow-xl leading-normal z-50 pointer-events-none text-center">
                  There are unsaved changes. Save settings to apply them.
                  <div className="absolute top-full right-4 -mt-1 border-4 border-transparent border-t-slate-900" />
                </div>
              </div>
            )}
          </div>
          <div className="text-[10px] text-white/20 text-center mt-2.5 font-mono">
            v{currentVersion || "1.0.0"}
          </div>
        </div>
      </aside>

      {/* Main Content Pane */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-slate-950">
        {/* Update Notification Banner */}
        {updateAvailable && !dismissUpdate && (
          <div className="px-8 pt-6">
            <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 animate-fade-in">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-indigo-500/20 rounded-lg text-indigo-400">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-sm text-white">New Update Available: v{updateVersion}</h4>
                  <p className="text-xs text-white/60 mt-0.5">
                    {isDownloadingUpdate 
                      ? downloadProgressText 
                      : (updateError ? <span className="text-red-400 font-semibold">{updateError}</span> : "A new version of AIna-sensei is ready. Would you like to update now?")
                    }
                  </p>
                  {!isDownloadingUpdate && updateNotes && (
                    <button
                      type="button"
                      onClick={() => setShowNotesModal(true)}
                      className="text-[10px] text-indigo-400 hover:text-indigo-300 font-semibold underline mt-1 cursor-pointer block text-left"
                    >
                      View Release Notes
                    </button>
                  )}
                  {isDownloadingUpdate && (
                    <div className="w-full bg-white/10 rounded-full h-1.5 mt-2">
                      <div 
                        className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300" 
                        style={{ width: `${downloadProgress}%` }}
                      ></div>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 self-end md:self-center">
                {!isDownloadingUpdate ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setDismissUpdate(true)}
                      className="text-white/40 hover:text-white/70 font-medium text-xs px-3 py-2 rounded-xl transition-all cursor-pointer"
                    >
                      Later
                    </button>
                    <button
                      type="button"
                      onClick={handleInstallUpdate}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs px-4 py-2 rounded-xl transition-all cursor-pointer"
                    >
                      Update & Restart
                    </button>
                  </>
                ) : (
                  <span className="text-xs text-indigo-400 font-semibold animate-pulse px-3 py-2">
                    Updating...
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Status Alerts Bar */}
        {(successMsg || errorMsg) && (
          <div className="px-8 pt-6">
            {successMsg && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-emerald-400 text-xs flex gap-2 animate-fade-in">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{successMsg}</span>
              </div>
            )}
            {errorMsg && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-red-400 text-xs flex gap-2 animate-fade-in">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>{errorMsg}</span>
              </div>
            )}
          </div>
        )}

        {/* Tab Title Area */}
        <div className="px-8 pt-6 pb-2">
          {activeTab === "general" && (
            <div>
              <h2 className="text-xl font-bold tracking-tight">Global Hotkeys</h2>
              <p className="text-xs text-white/40 mt-0.5">Define regional screenshot triggers and overlay visibility keys.</p>
            </div>
          )}
          {activeTab === "ocr" && (
            <div>
              <h2 className="text-xl font-bold tracking-tight">OCR & Character Recognition</h2>
              <p className="text-xs text-white/40 mt-0.5">Configure target OCR languages and Google Cloud Vision integration credentials.</p>
            </div>
          )}
          {activeTab === "ai" && (
            <div>
              <h2 className="text-xl font-bold tracking-tight">AI Tutor Configuration</h2>
              <p className="text-xs text-white/40 mt-0.5">Select local LLM servers or cloud endpoints and customize system instruction prompts.</p>
            </div>
          )}
          {activeTab === "ui" && (
            <div>
              <h2 className="text-xl font-bold tracking-tight">Interface & HUD Settings</h2>
              <p className="text-xs text-white/40 mt-0.5">Style the overlay HUD layout, control transparency, and window behaviors.</p>
            </div>
          )}
        </div>

        {/* Active Content Scroll Area */}
        <div className="flex-1 overflow-y-auto px-8 py-4 pb-12 custom-scrollbar">
          <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl">
            {/* RENDER ACTIVE TAB */}
            {activeTab === "general" && (
              <div className="space-y-5">
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
            )}

            {activeTab === "ocr" && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                  <div>
                    <label className="block text-xs font-semibold text-white/50 mb-1.5">Target Recognition Language</label>
                    <select
                      value={config.ocr.target_language}
                      onChange={(e) => updateConfigField("ocr", "target_language", e.target.value)}
                      className="w-full bg-black/40 border border-white/15 focus:border-blue-500 rounded-xl px-3 py-2.5 text-sm text-white outline-none transition-all cursor-pointer"
                    >
                      <option value="ja">Japanese (ja)</option>
                      <option value="en">English (en)</option>
                      <option value="es">Spanish (es)</option>
                      <option value="zh">Chinese (zh)</option>
                      <option value="ko">Korean (ko)</option>
                      <option value="fr">French (fr)</option>
                      <option value="de">German (de)</option>
                    </select>
                  </div>
                </div>

                <div>
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
            )}

            {activeTab === "ai" && (
              <div className="space-y-5">
                {/* Configuration Presets Section */}
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-4 shadow-inner">
                  <div className="flex flex-col md:flex-row md:items-end gap-3">
                    <div className="flex-1">
                      <label className="block text-xs font-semibold text-white/50 mb-1.5">Load Configuration Preset</label>
                      <div 
                        className="relative text-left"
                        onBlur={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                            setIsPresetDropdownOpen(false);
                          }
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setIsPresetDropdownOpen(!isPresetDropdownOpen)}
                          className="w-full text-left bg-black/40 border border-white/15 focus:border-blue-500 rounded-xl pl-3 pr-10 py-2.5 text-sm text-white outline-none transition-all cursor-pointer relative"
                        >
                          {selectedPresetName || "-- Select a preset to load --"}
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none">
                            <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${isPresetDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </span>
                        </button>
                        {isPresetDropdownOpen && (
                          <ul className="absolute left-0 right-0 z-50 mt-1.5 max-h-60 overflow-y-auto bg-[#18181b] border border-white/15 rounded-xl shadow-xl py-1 outline-none text-left scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                            <li
                              onMouseDown={() => {
                                setSelectedPresetName("");
                                setIsPresetDropdownOpen(false);
                              }}
                              className="px-3 py-2 text-xs text-white/40 italic hover:bg-white/5 cursor-pointer"
                            >
                              -- Select a preset to load --
                            </li>
                            {Object.keys(config.presets || {}).map((name) => (
                              <li
                                key={name}
                                onMouseDown={() => {
                                  handleLoadPreset(name);
                                  setIsPresetDropdownOpen(false);
                                }}
                                className={`px-3 py-2 text-xs text-white/80 hover:text-white hover:bg-white/5 cursor-pointer transition-all ${
                                  selectedPresetName === name ? "text-blue-400 font-semibold bg-white/5" : ""
                                }`}
                              >
                                {name}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                    {selectedPresetName && !["Japanese Tutor (Default)", "English Translator"].includes(selectedPresetName) && (
                      <button
                        type="button"
                        onClick={handleDeletePreset}
                        className="bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/40 text-red-400 font-semibold text-xs py-2.5 px-4 rounded-xl transition-all cursor-pointer flex-shrink-0"
                      >
                        Delete Preset
                      </button>
                    )}
                  </div>

                  <div className="border-t border-white/5 pt-3">
                    <label className="block text-xs font-semibold text-white/50 mb-1.5">Save Current Settings as Preset</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newPresetName}
                        onChange={(e) => setNewPresetName(e.target.value)}
                        placeholder="Preset name (e.g. Spanish Tutor, Programming Assistant)..."
                        className="flex-1 bg-black/40 border border-white/15 focus:border-blue-500 rounded-xl px-3 py-2 text-sm text-white outline-none transition-all"
                      />
                      <button
                        type="button"
                        onClick={handleSavePreset}
                        disabled={!newPresetName.trim()}
                        className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs px-4 py-2.5 rounded-xl transition-all cursor-pointer flex-shrink-0"
                      >
                        Save Preset
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-white/50 mb-1.5">Provider</label>
                    <div 
                      className="relative text-left"
                      onBlur={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                          setIsProviderDropdownOpen(false);
                        }
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setIsProviderDropdownOpen(!isProviderDropdownOpen)}
                        className="w-full text-left bg-black/40 border border-white/15 focus:border-blue-500 rounded-xl pl-3 pr-10 py-2.5 text-sm text-white outline-none transition-all cursor-pointer relative"
                      >
                        {(() => {
                          if (config.llm.provider === "ollama") return "Ollama (Local)";
                          if (config.llm.provider === "gemini") return "Google Gemini (Cloud)";
                          if (config.llm.provider === "openai") return "OpenAI (Cloud)";
                          if (config.llm.provider === "custom") return "Custom OpenAI-Compatible";
                          return config.llm.provider;
                        })()}
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none">
                          <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${isProviderDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </span>
                      </button>
                      {isProviderDropdownOpen && (
                        <ul className="absolute left-0 right-0 z-50 mt-1.5 max-h-60 overflow-y-auto bg-[#18181b] border border-white/15 rounded-xl shadow-xl py-1 outline-none text-left scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                          {[
                            { val: "ollama", label: "Ollama (Local)" },
                            { val: "gemini", label: "Google Gemini (Cloud)" },
                            { val: "openai", label: "OpenAI (Cloud)" },
                            { val: "custom", label: "Custom OpenAI-Compatible" },
                          ].map((opt) => (
                            <li
                              key={opt.val}
                              onMouseDown={() => {
                                handleProviderChange(opt.val);
                                setIsProviderDropdownOpen(false);
                              }}
                              className={`px-3 py-2 text-xs text-white/80 hover:text-white hover:bg-white/5 cursor-pointer transition-all ${
                                config.llm.provider === opt.val ? "text-blue-400 font-semibold bg-white/5" : ""
                              }`}
                            >
                              {opt.label}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-white/50 mb-1.5 flex items-center">
                      Model Identifier Name
                      {fetchingModels && (
                        <span className="text-[10px] text-blue-400 ml-2 animate-pulse font-normal">
                          (fetching available models...)
                        </span>
                      )}
                    </label>
                    <div 
                      className="relative text-left"
                      onBlur={(e) => {
                        // Close dropdown only if focus left the entire combobox container
                        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                          setIsDropdownOpen(false);
                        }
                      }}
                    >
                      <input
                        type="text"
                        value={config.llm.model}
                        onFocus={() => {
                          setIsDropdownOpen(true);
                          setShowAllOptions(false);
                          setFocusedIndex(-1);
                        }}
                        onClick={() => {
                          setIsDropdownOpen(true);
                          setShowAllOptions(true);
                          setFocusedIndex(-1);
                        }}
                        onChange={(e) => {
                          updateConfigField("llm", "model", e.target.value);
                          setIsDropdownOpen(true);
                          setShowAllOptions(false);
                          setFocusedIndex(-1);
                        }}
                        onKeyDown={(e) => {
                          const filtered = getFilteredModels();
                          if (e.key === "Escape") {
                            setIsDropdownOpen(false);
                          } else if (e.key === "ArrowDown") {
                            e.preventDefault();
                            setIsDropdownOpen(true);
                            setFocusedIndex(prev => (prev < filtered.length - 1 ? prev + 1 : prev));
                          } else if (e.key === "ArrowUp") {
                            e.preventDefault();
                            setIsDropdownOpen(true);
                            setFocusedIndex(prev => (prev > 0 ? prev - 1 : prev));
                          } else if (e.key === "Enter") {
                            if (isDropdownOpen && focusedIndex >= 0 && focusedIndex < filtered.length) {
                              e.preventDefault();
                              updateConfigField("llm", "model", filtered[focusedIndex]);
                              setIsDropdownOpen(false);
                            }
                          }
                        }}
                        placeholder="Select or type model name (e.g. gpt-4o, llama3)"
                        className="w-full bg-black/40 border border-white/15 focus:border-blue-500 rounded-xl pl-3 pr-10 py-2.5 text-sm text-white outline-none transition-all"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setIsDropdownOpen(!isDropdownOpen);
                          setShowAllOptions(true);
                          setFocusedIndex(-1);
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-all outline-none cursor-pointer"
                      >
                        <svg 
                          className={`w-3.5 h-3.5 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} 
                          fill="none" 
                          viewBox="0 0 24 24" 
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {isDropdownOpen && (
                        <ul className="absolute left-0 right-0 z-50 mt-1.5 max-h-60 overflow-y-auto bg-[#18181b] border border-white/15 rounded-xl shadow-xl py-1 outline-none text-left scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                          {(() => {
                            const filtered = getFilteredModels();

                            if (filtered.length === 0) {
                              return (
                                <li className="px-3 py-2 text-xs text-white/40 italic">
                                  No matching models found. Keep typing or press Enter to keep custom.
                                </li>
                              );
                            }

                            return filtered.map((m, index) => (
                              <li
                                key={m}
                                onMouseDown={() => {
                                  updateConfigField("llm", "model", m);
                                  setIsDropdownOpen(false);
                                }}
                                className={`px-3 py-2 text-xs text-white/80 hover:text-white cursor-pointer transition-all ${
                                  config.llm.model === m ? "text-blue-400 font-semibold" : ""
                                } ${
                                  focusedIndex === index ? "bg-white/10 text-white font-semibold" : "hover:bg-white/5"
                                }`}
                              >
                                {m}
                              </li>
                            ));
                          })()}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-white/50 mb-1.5">API Endpoint URL</label>
                  <div 
                    className="relative text-left"
                    onBlur={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setIsUrlDropdownOpen(false);
                      }
                    }}
                  >
                    <input
                      type="text"
                      value={config.llm.endpoint_url}
                      onFocus={() => {
                        setIsUrlDropdownOpen(true);
                        setShowAllUrls(false);
                        setUrlFocusedIndex(-1);
                      }}
                      onClick={() => {
                        setIsUrlDropdownOpen(true);
                        setShowAllUrls(true);
                        setUrlFocusedIndex(-1);
                      }}
                      onChange={(e) => {
                        updateConfigField("llm", "endpoint_url", e.target.value);
                        setIsUrlDropdownOpen(true);
                        setShowAllUrls(false);
                        setUrlFocusedIndex(-1);
                      }}
                      onKeyDown={(e) => {
                        const filtered = getFilteredUrls();
                        if (e.key === "Escape") {
                          setIsUrlDropdownOpen(false);
                        } else if (e.key === "ArrowDown") {
                          e.preventDefault();
                          setIsUrlDropdownOpen(true);
                          setUrlFocusedIndex(prev => (prev < filtered.length - 1 ? prev + 1 : prev));
                        } else if (e.key === "ArrowUp") {
                          e.preventDefault();
                          setIsUrlDropdownOpen(true);
                          setUrlFocusedIndex(prev => (prev > 0 ? prev - 1 : prev));
                        } else if (e.key === "Enter") {
                          if (isUrlDropdownOpen && urlFocusedIndex >= 0 && urlFocusedIndex < filtered.length) {
                            e.preventDefault();
                            updateConfigField("llm", "endpoint_url", filtered[urlFocusedIndex]);
                            setIsUrlDropdownOpen(false);
                          }
                        }
                      }}
                      placeholder="e.g., http://localhost:11434"
                      className="w-full bg-black/40 border border-white/15 focus:border-blue-500 rounded-xl pl-3 pr-10 py-2.5 text-sm text-white outline-none transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setIsUrlDropdownOpen(!isUrlDropdownOpen);
                        setShowAllUrls(true);
                        setUrlFocusedIndex(-1);
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-all outline-none cursor-pointer"
                    >
                      <svg 
                        className={`w-3.5 h-3.5 transition-transform duration-200 ${isUrlDropdownOpen ? 'rotate-180' : ''}`} 
                        fill="none" 
                        viewBox="0 0 24 24" 
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {isUrlDropdownOpen && (
                      <ul className="absolute left-0 right-0 z-50 mt-1.5 max-h-60 overflow-y-auto bg-[#18181b] border border-white/15 rounded-xl shadow-xl py-1 outline-none text-left scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                        {(() => {
                          const filtered = getFilteredUrls();

                          if (filtered.length === 0) {
                            return (
                              <li className="px-3 py-2 text-xs text-white/40 italic">
                                No matching suggestions found. Keep typing.
                              </li>
                            );
                          }

                          return filtered.map((u, index) => (
                            <li
                              key={u}
                              onMouseDown={() => {
                                updateConfigField("llm", "endpoint_url", u);
                                setIsUrlDropdownOpen(false);
                              }}
                              className={`px-3 py-2 text-xs text-white/80 hover:text-white cursor-pointer transition-all ${
                                config.llm.endpoint_url === u ? "text-blue-400 font-semibold" : ""
                              } ${
                                urlFocusedIndex === index ? "bg-white/10 text-white font-semibold" : "hover:bg-white/5"
                              }`}
                            >
                              {u}
                            </li>
                          ));
                        })()}
                      </ul>
                    )}
                  </div>
                </div>

                <div>
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

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="block text-xs font-semibold text-white/50">Tutor System Prompt</label>
                    <span className="text-[10px] bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded">
                      Use {"{extracted_text}"} for substitutions
                    </span>
                  </div>
                  <textarea
                    value={config.llm.system_prompt}
                    onChange={(e) => updateConfigField("llm", "system_prompt", e.target.value)}
                    rows={12}
                    className="w-full bg-black/40 border border-white/15 focus:border-blue-500 rounded-xl px-3 py-2.5 text-xs text-white outline-none transition-all resize-none font-mono"
                    required
                  />
                </div>
              </div>
            )}

            {activeTab === "ui" && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center justify-between bg-black/20 border border-white/5 p-4 rounded-xl">
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
                  
                  <div className="flex items-center justify-between bg-black/20 border border-white/5 p-4 rounded-xl">
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
              </div>
            )}
          </form>
        </div>
      </main>

      {/* Release Notes Modal Overlay */}
      {showNotesModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4 animate-fade-in text-left">
            <div className="flex justify-between items-center border-b border-white/5 pb-3">
              <h3 className="text-sm font-bold text-white">Release Notes — v{updateVersion}</h3>
              <button 
                type="button" 
                onClick={() => setShowNotesModal(false)}
                className="text-white/40 hover:text-white/70 transition-all text-xs font-semibold cursor-pointer"
              >
                ✕
              </button>
            </div>
            
            <div className="max-h-60 overflow-y-auto text-xs text-white/70 leading-relaxed scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent pr-2 markdown-body space-y-2">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {updateNotes}
              </ReactMarkdown>
            </div>

            <div className="flex justify-end pt-2 border-t border-white/5">
              <button
                type="button"
                onClick={() => setShowNotesModal(false)}
                className="bg-white/10 hover:bg-white/15 text-white font-semibold text-xs px-4 py-2.5 rounded-xl transition-all cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
