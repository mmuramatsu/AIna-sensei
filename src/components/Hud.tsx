import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppConfig } from "../lib/types";
import { performOcr, performLlmQuery } from "../services/api";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const markdownComponents = {
  h1: ({ node, ...props }: any) => (
    <h2 className="text-lg font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400 mt-6 mb-3" {...props} />
  ),
  h2: ({ node, ...props }: any) => (
    <h3 className="text-base font-bold text-indigo-400 mt-5 mb-2 border-b border-white/5 pb-1" {...props} />
  ),
  h3: ({ node, ...props }: any) => (
    <h4 className="text-sm font-semibold text-blue-400 mt-4 mb-2 tracking-wide uppercase" {...props} />
  ),
  p: ({ node, ...props }: any) => (
    <p className="text-white/80 text-sm leading-relaxed my-1.5 pl-1" {...props} />
  ),
  strong: ({ node, ...props }: any) => (
    <strong className="text-yellow-300 font-bold bg-yellow-500/5 px-1 py-0.5 rounded border border-yellow-500/10" {...props} />
  ),
  ul: ({ node, ...props }: any) => (
    <ul className="list-disc pl-5 my-2 space-y-1" {...props} />
  ),
  ol: ({ node, ...props }: any) => (
    <ol className="list-decimal pl-5 my-2 space-y-1" {...props} />
  ),
  li: ({ node, ...props }: any) => (
    <li className="text-white/80 text-sm leading-relaxed my-1" {...props} />
  ),
  blockquote: ({ node, ...props }: any) => (
    <blockquote className="border-l-4 border-indigo-500/40 bg-indigo-500/5 pl-3 py-1 my-2 rounded-r italic text-white/70 text-sm" {...props} />
  ),
  a: ({ node, ...props }: any) => (
    <a className="text-blue-400 hover:text-blue-300 underline" {...props} />
  ),
  hr: ({ node, ...props }: any) => (
    <hr className="border-white/10 my-4" {...props} />
  ),
  table: ({ node, ...props }: any) => (
    <div className="overflow-x-auto my-3 rounded-lg border border-white/10 custom-scrollbar">
      <table className="min-w-full divide-y divide-white/10 bg-white/5" {...props} />
    </div>
  ),
  thead: ({ node, ...props }: any) => (
    <thead className="bg-white/10" {...props} />
  ),
  tbody: ({ node, ...props }: any) => (
    <tbody className="divide-y divide-white/5 bg-black/20" {...props} />
  ),
  tr: ({ node, ...props }: any) => (
    <tr className="hover:bg-white/5 transition-colors" {...props} />
  ),
  th: ({ node, ...props }: any) => (
    <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-blue-300 border-r border-white/10 last:border-r-0" {...props} />
  ),
  td: ({ node, ...props }: any) => (
    <td className="px-3 py-2 text-xs text-white/80 border-r border-white/5 last:border-r-0 whitespace-nowrap" {...props} />
  ),
  code: ({ node, className, children, ...props }: any) => {
    const match = /language-(\w+)/.exec(className || '');
    const inline = !match;
    return inline ? (
      <code className="bg-white/10 px-1 py-0.5 rounded font-mono text-xs text-indigo-300" {...props}>
        {children}
      </code>
    ) : (
      <pre className="bg-black/50 p-2 rounded overflow-x-auto my-2 border border-white/5">
        <code className="font-mono text-xs text-indigo-300" {...props}>
          {children}
        </code>
      </pre>
    );
  }
};

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
          detectedText ? null : imageBase64, // Send image ONLY if OCR failed/bypassed
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

    // Listen for config changes from the Settings window
    const unlistenConfigPromise = listen("config-updated", () => {
      fetchConfig();
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
      unlistenConfigPromise.then((unlisten) => unlisten());
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

  const cleanExplanation = (text: string) => {
    if (!text) return "";
    return text
      .replace(/\$\\rightarrow\$/g, "→")
      .replace(/\\rightarrow/g, "→")
      .replace(/\$\\implies\$/g, "⇒")
      .replace(/\\implies/g, "⇒")
      .replace(/\$\\leftrightarrow\$/g, "↔")
      .replace(/\\leftrightarrow/g, "↔")
      .replace(/\$\\sim\$/g, "~")
      .replace(/\\sim/g, "~")
      .replace(/\$\\times\$/g, "×")
      .replace(/\\times/g, "×")
      .replace(/\$\\cdot\$/g, "•")
      .replace(/\\cdot/g, "•")
      .replace(/\$\\dots\$/g, "…")
      .replace(/\\dots/g, "…");
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
                <div className="space-y-1">
                  <p className="text-sm font-semibold mt-1 text-white truncate font-japanese leading-relaxed" title={ocrText}>
                    {ocrText}
                  </p>
                  <p className="text-[10px] text-emerald-400 font-medium flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                    Text recognized successfully
                  </p>
                </div>
              ) : loading ? (
                <div className="h-6 mt-1 flex items-center">
                  <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-white/40 ml-2 animate-pulse">
                    {config?.ocr.mode === "llm_multimodal" 
                      ? "Tutor reading image directly..." 
                      : "Processing capture..."}
                  </span>
                </div>
              ) : explanation ? (
                <p className="text-xs text-emerald-400 font-medium mt-1 flex items-center gap-1 animate-pulse">
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                  Processed successfully via Vision LLM
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
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {cleanExplanation(explanation)}
            </ReactMarkdown>

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
