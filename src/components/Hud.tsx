import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppConfig } from "../lib/types";
import { performOcr, performLlmQuery } from "../services/api";

export function Hud() {
  const [loading, setLoading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocrText, setOcrText] = useState("");
  const [explanation, setExplanation] = useState("");
  const [croppedImage, setCroppedImage] = useState<string | null>(null);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [config, setConfig] = useState<AppConfig | null>(null);
  
  const contentEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll explanation as it streams
  useEffect(() => {
    if (contentEndRef.current) {
      contentEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [explanation]);

  // Load config on mount
  const fetchConfig = async () => {
    try {
      const currentConfig = await invoke<AppConfig>("load_config");
      setConfig(currentConfig);
      setAlwaysOnTop(currentConfig.ui.always_on_top);
      await getCurrentWindow().setAlwaysOnTop(currentConfig.ui.always_on_top);
    } catch (err) {
      console.error("Failed to load config in HUD:", err);
    }
  };

  useEffect(() => {
    fetchConfig();

    // Listen for image from the snipper overlay
    const unlistenPromise = listen<{ image: string }>("explain-image", async (event) => {
      const imageBase64 = event.payload.image;
      setCroppedImage(imageBase64);
      setExplanation("");
      setOcrText("");
      setError(null);
      setLoading(true);
      setOcrLoading(true);

      try {
        // Load latest config in case it changed
        const currentConfig = await invoke<AppConfig>("load_config");
        setConfig(currentConfig);

        let detectedText = "";
        
        // 1. Run OCR (if Cloud Vision is selected and Key is provided)
        if (
          currentConfig.ocr.mode === "cloud_vision" &&
          currentConfig.ocr.api_key &&
          currentConfig.ocr.api_key !== "YOUR_VISION_API_KEY"
        ) {
          try {
            detectedText = await performOcr(imageBase64, currentConfig.ocr);
            setOcrText(detectedText);
          } catch (ocrErr: any) {
            console.warn("OCR failed, falling back to direct LLM processing:", ocrErr);
            // Don't fail the whole request, try LLM fallback directly
          }
        }
        
        setOcrLoading(false);

        // 2. Prepare LLM prompt
        // If OCR was successful, inject it. Otherwise, instruct LLM to transcribe & translate.
        let finalPrompt = "";
        if (detectedText) {
          finalPrompt = currentConfig.llm.system_prompt.replace("{extracted_text}", detectedText);
        } else {
          finalPrompt = `${currentConfig.llm.system_prompt}\n\n[NO OCR DETECTED - PLEASE TRANSCRIBE AND ANALYZE THE TARGET IMAGE DIRECTLY]`;
        }

        // 3. Query LLM and Stream results
        await performLlmQuery(
          finalPrompt,
          imageBase64, // Send image for multimodal if provider supports it
          currentConfig.llm,
          (chunk) => {
            setExplanation((prev) => prev + chunk);
          }
        );

      } catch (err: any) {
        console.error("HUD processing pipeline failed:", err);
        setError(err.message || "Failed to process the selection.");
      } finally {
        setOcrLoading(false);
        setLoading(false);
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const handleClose = async () => {
    await invoke("hide_window", { label: "hud" });
  };

  const handleTogglePin = async () => {
    const nextState = !alwaysOnTop;
    setAlwaysOnTop(nextState);
    await getCurrentWindow().setAlwaysOnTop(nextState);
    
    // Save state back to backend config
    if (config) {
      const updated = {
        ...config,
        ui: {
          ...config.ui,
          always_on_top: nextState,
        },
      };
      setConfig(updated);
      await invoke("save_config", { config: updated });
    }
  };

  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  // Convert raw markdown line breaks and structure to HTML styles for premium looks
  const formatExplanation = (rawText: string) => {
    if (!rawText) return null;
    
    return rawText.split("\n").map((line, idx) => {
      const trimmed = line.trim();
      if (!trimmed) return <div key={idx} className="h-2" />;

      // Main headings (e.g. ### Headers)
      if (trimmed.startsWith("###")) {
        return (
          <h4 key={idx} className="text-sm font-semibold text-blue-400 mt-4 mb-2 tracking-wide uppercase">
            {trimmed.replace("###", "").trim()}
          </h4>
        );
      }
      if (trimmed.startsWith("##")) {
        return (
          <h3 key={idx} className="text-base font-bold text-indigo-400 mt-5 mb-2 border-b border-white/5 pb-1">
            {trimmed.replace("##", "").trim()}
          </h3>
        );
      }
      if (trimmed.startsWith("#")) {
        return (
          <h2 key={idx} className="text-lg font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400 mt-6 mb-3">
            {trimmed.replace("#", "").trim()}
          </h2>
        );
      }

      // Ordered list items (e.g., 1. Natural English Translation)
      const numListMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
      if (numListMatch) {
        return (
          <div key={idx} className="flex gap-2 items-start my-2">
            <span className="flex items-center justify-center bg-blue-500/10 text-blue-400 rounded-md px-1.5 py-0.5 text-xs font-bold border border-blue-500/20">
              {numListMatch[1]}
            </span>
            <span className="text-white/90 text-sm font-medium leading-relaxed">{numListMatch[2]}</span>
          </div>
        );
      }

      // Bullet points
      if (trimmed.startsWith("-") || trimmed.startsWith("*")) {
        return (
          <div key={idx} className="flex gap-2 items-center my-1.5 pl-2 text-white/80 text-sm leading-relaxed">
            <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full flex-shrink-0" />
            <span>{trimmed.substring(1).trim()}</span>
          </div>
        );
      }

      // General Text - parse inline furigana or key phrases in bold `**text**`
      let formattedLine = trimmed;
      const boldParts = trimmed.split(/\*\*([^*]+)\*\*/g);
      if (boldParts.length > 1) {
        return (
          <p key={idx} className="text-white/80 text-sm leading-relaxed my-1 pl-1">
            {boldParts.map((part, pIdx) =>
              pIdx % 2 === 1 ? (
                <strong key={pIdx} className="text-yellow-300 font-bold bg-yellow-500/5 px-1 py-0.5 rounded border border-yellow-500/10">
                  {part}
                </strong>
              ) : (
                part
              )
            )}
          </p>
        );
      }

      return (
        <p key={idx} className="text-white/80 text-sm leading-relaxed my-1 pl-1">
          {formattedLine}
        </p>
      );
    });
  };

  return (
    <div className="w-screen h-screen flex flex-col bg-slate-950/90 text-white rounded-l-2xl border-l border-y border-white/10 shadow-2xl overflow-hidden backdrop-blur-xl">
      {/* Premium Glassmorphic Header */}
      <header className="flex justify-between items-center px-4 py-3 bg-white/5 border-b border-white/10 select-none">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-white/70">AIna-sensei HUD</h2>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Always on top toggle pin */}
          <button
            onClick={handleTogglePin}
            className={`p-1.5 rounded-lg border transition-all ${
              alwaysOnTop
                ? "bg-blue-500/20 border-blue-500/40 text-blue-400"
                : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white"
            }`}
            title={alwaysOnTop ? "Overlay pinned (Always on Top)" : "Overlay unpinned"}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="15" x2="20" y2="15"></line>
              <line x1="4" y1="9" x2="20" y2="9"></line>
              <line x1="9" y1="4" x2="9" y2="20"></line>
              <line x1="15" y1="4" x2="15" y2="20"></line>
            </svg>
          </button>
          
          {/* Close HUD */}
          <button
            onClick={handleClose}
            className="p-1.5 bg-white/5 border border-white/10 rounded-lg text-white/50 hover:bg-red-500/20 hover:border-red-500/40 hover:text-red-400 transition-all"
            title="Close overlay"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4 custom-scrollbar">
        {/* Dynamic State HUD Messages */}
        {!croppedImage && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-3 py-10">
            <div className="w-12 h-12 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-center text-white/40">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-white/80">No Capture Selected</p>
              <p className="text-xs text-white/40 mt-1">Press your global shortcut key to capture text on screen.</p>
              {config && (
                <code className="inline-block mt-3 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 px-2.5 py-1 rounded-md text-xs font-mono">
                  {config.hotkeys.capture_region}
                </code>
              )}
            </div>
          </div>
        )}

        {/* Capture Snapshot Block */}
        {croppedImage && (
          <div className="flex gap-3 bg-white/5 border border-white/10 rounded-xl p-3 items-center backdrop-blur shadow-sm">
            <div className="w-24 max-h-16 rounded border border-white/10 bg-black/40 overflow-hidden flex-shrink-0 flex items-center justify-center">
              <img src={croppedImage} alt="Cropped regional selection" className="object-contain w-full h-full max-h-16" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-center">
                <span className="text-[10px] uppercase font-bold text-white/40 tracking-wider">Extracted Region</span>
                {ocrText && (
                  <button
                    onClick={() => handleCopyText(ocrText)}
                    className="text-[10px] text-blue-400 hover:text-blue-300 font-semibold uppercase tracking-wider flex items-center gap-1"
                  >
                    Copy text
                  </button>
                )}
              </div>
              
              {/* OCR text display box */}
              {ocrLoading ? (
                <div className="h-6 mt-1 flex items-center">
                  <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-white/40 ml-2 animate-pulse">Running Cloud Vision OCR...</span>
                </div>
              ) : ocrText ? (
                <p className="text-sm font-semibold mt-1 text-white truncate font-japanese leading-relaxed" title={ocrText}>
                  {ocrText}
                </p>
              ) : (
                <p className="text-xs italic text-white/30 mt-1">Waiting for character recognition...</p>
              )}
            </div>
          </div>
        )}

        {/* Error Message banner */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-red-400 text-xs flex gap-2.5 items-start">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="font-semibold">Pipeline Error</p>
              <p className="text-white/60 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Explanation Stream display */}
        {(explanation || loading) && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 backdrop-blur shadow-sm space-y-1">
            <span className="text-[10px] uppercase font-bold text-white/40 tracking-wider block mb-1">AIna-sensei Analysis</span>
            
            {/* Formatted streamed response */}
            {formatExplanation(explanation)}

            {/* Shimmer loading feedback while AI is processing the output */}
            {loading && !explanation && (
              <div className="space-y-2 py-2">
                <div className="h-4 bg-white/10 rounded animate-pulse w-3/4" />
                <div className="h-4 bg-white/10 rounded animate-pulse w-5/6" />
                <div className="h-4 bg-white/10 rounded animate-pulse w-2/3" />
              </div>
            )}
            
            <div ref={contentEndRef} />
          </div>
        )}
      </main>
    </div>
  );
}
