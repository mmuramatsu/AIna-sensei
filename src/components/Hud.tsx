import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppConfig, Conversation, ConversationMeta } from "../lib/types";
import { performOcr, performLlmQuery, ChatMessage } from "../services/api";
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [croppedImage, setCroppedImage] = useState<string | null>(null);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [config, setConfig] = useState<AppConfig | null>(null);
  
  // Conversation history states
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [conversationsList, setConversationsList] = useState<ConversationMeta[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const contentEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const shouldScrollRef = useRef(true);

  const handleScroll = () => {
    const main = mainRef.current;
    if (!main) return;
    // If the user scrolls within 60px of the bottom, lock to bottom; otherwise, unlock
    const threshold = 60;
    const isCloseToBottom = main.scrollHeight - main.scrollTop - main.clientHeight < threshold;
    shouldScrollRef.current = isCloseToBottom;
  };

  // Auto-scroll explanation as it streams or messages are added
  useEffect(() => {
    if (shouldScrollRef.current && contentEndRef.current) {
      // Use instant scroll during generation to prevent animation jitters, smooth scroll for static changes
      contentEndRef.current.scrollIntoView({ 
        behavior: loading ? "auto" : "smooth" 
      });
    }
  }, [messages, loading]);

  // Auto-resize the chat textarea height up to 6 lines
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [chatInput]);

  const loadHistoryList = async () => {
    try {
      const list = await invoke<ConversationMeta[]>("list_conversations");
      setConversationsList(list);
    } catch (err) {
      console.error("Failed to load conversation history:", err);
    }
  };

  const startNewConversation = () => {
    setCroppedImage(null);
    setMessages([]);
    setOcrText("");
    setActiveConvId(null);
    setError(null);
    setLoading(false);
    setOcrLoading(false);
    setIsHistoryOpen(false);
  };

  const selectConversation = async (id: string) => {
    try {
      const conv = await invoke<Conversation>("load_conversation", { id });
      setCroppedImage(conv.cropped_image);
      setMessages(conv.messages);
      setOcrText(conv.ocr_text || "");
      setActiveConvId(conv.id);
      setError(null);
      setIsHistoryOpen(false);
    } catch (err: any) {
      console.error("Failed to load conversation:", err);
      setError(err.message || "Failed to load the conversation.");
    }
  };

  const deleteConv = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); // Prevent selecting the conversation
    try {
      await invoke("delete_conversation", { id });
      if (activeConvId === id) {
        startNewConversation();
      }
      loadHistoryList();
    } catch (err) {
      console.error("Failed to delete conversation:", err);
    }
  };

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
    loadHistoryList();

    // Listen for image from the snipper overlay
    const unlistenPromise = listen<{ image: string }>("explain-image", async (event) => {
      const imageBase64 = event.payload.image;
      setCroppedImage(imageBase64);
      setMessages([]);
      setOcrText("");
      setError(null);
      setLoading(true);
      setOcrLoading(true);
      shouldScrollRef.current = true; // Lock to bottom for new query

      const newId = String(Date.now());
      setActiveConvId(newId);

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
        let finalPrompt = "";
        if (detectedText) {
          finalPrompt = currentConfig.llm.system_prompt.replace("{extracted_text}", detectedText);
        } else {
          finalPrompt = `${currentConfig.llm.system_prompt}\n\n[NO OCR DETECTED - PLEASE TRANSCRIBE AND ANALYZE THE TARGET IMAGE DIRECTLY]`;
        }

        const initialMessages = [
          { role: "user" as const, content: detectedText ? finalPrompt : `${finalPrompt}\n\n[Analyzing the screenshot directly]` },
          { role: "assistant" as const, content: "" }
        ];
        setMessages(initialMessages);

        const generatedTitle = detectedText 
          ? (detectedText.length > 25 ? `${detectedText.slice(0, 25)}...` : detectedText)
          : `Visual Analysis - ${new Date().toLocaleDateString()}`;

        // Save initial turn state (assistant empty)
        await invoke("save_conversation", {
          conversation: {
            id: newId,
            title: generatedTitle,
            timestamp: Date.now(),
            cropped_image: imageBase64,
            ocr_text: detectedText,
            messages: initialMessages
          }
        });
        await loadHistoryList();

        let accumulatedResponse = "";

        // 3. Query LLM and Stream results
        await performLlmQuery(
          initialMessages,
          detectedText ? null : imageBase64, // Send image ONLY if OCR failed/bypassed
          currentConfig.llm,
          (chunk) => {
            accumulatedResponse += chunk;
            setMessages((prev) => {
              const next = [...prev];
              if (next.length > 0) {
                const lastIdx = next.length - 1;
                next[lastIdx] = {
                  ...next[lastIdx],
                  content: next[lastIdx].content + chunk,
                };
              }
              return next;
            });
          }
        );

        // Save final completed assistant response to history
        const finalMessages = [
          initialMessages[0],
          { role: "assistant" as const, content: accumulatedResponse }
        ];
        await invoke("save_conversation", {
          conversation: {
            id: newId,
            title: generatedTitle,
            timestamp: Date.now(),
            cropped_image: imageBase64,
            ocr_text: detectedText,
            messages: finalMessages
          }
        });
        await loadHistoryList();

      } catch (err: any) {
        console.error("HUD processing pipeline failed:", err);
        const errMsg = err instanceof Error ? err.stack || err.message : String(err);
        await invoke("write_debug_log", { log: `[HUD Pipeline Error] ${errMsg}` });
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

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || loading) return;

    shouldScrollRef.current = true; // Lock to bottom for new outgoing message
    const userMsg = chatInput.trim();
    setChatInput("");

    let id = activeConvId;
    if (!id) {
      id = String(Date.now());
      setActiveConvId(id);
    }

    // Setup message turns
    const updatedMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: userMsg },
      { role: "assistant", content: "" }
    ];
    setMessages(updatedMessages);
    setLoading(true);

    try {
      const historyToSend = updatedMessages.slice(0, -1);
      
      const currentTitle = conversationsList.find(c => c.id === id)?.title || 
        (userMsg.length > 25 ? `${userMsg.slice(0, 25)}...` : userMsg);

      // Save initial outgoing turn (assistant empty)
      await invoke("save_conversation", {
        conversation: {
          id: id,
          title: currentTitle,
          timestamp: Date.now(),
          cropped_image: croppedImage,
          ocr_text: ocrText,
          messages: updatedMessages
        }
      });
      await loadHistoryList();

      let accumulatedResponse = "";
      
      await performLlmQuery(
        historyToSend,
        null, // No image re-upload on follow-up chat turns
        config!.llm,
        (chunk) => {
          accumulatedResponse += chunk;
          setMessages((prev) => {
            const next = [...prev];
            if (next.length > 0) {
              const lastIdx = next.length - 1;
              next[lastIdx] = {
                ...next[lastIdx],
                content: next[lastIdx].content + chunk,
              };
            }
            return next;
          });
        }
      );

      // Save final completed assistant response to history
      const finalMessages = [
        ...historyToSend,
        { role: "assistant", content: accumulatedResponse }
      ];
      await invoke("save_conversation", {
        conversation: {
          id: id,
          title: currentTitle,
          timestamp: Date.now(),
          cropped_image: croppedImage,
          ocr_text: ocrText,
          messages: finalMessages
        }
      });
      await loadHistoryList();

    } catch (err: any) {
      console.error("Chat message failed:", err);
      setMessages((prev) => {
        const next = [...prev];
        if (next.length > 0) {
          next[next.length - 1] = {
            role: "assistant",
            content: `⚠️ Error: ${err.message || "Failed to query the AI backend."}`
          };
        }
        return next;
      });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(e);
    }
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
    <div className="w-screen h-screen flex flex-col bg-slate-950/90 text-white rounded-l-2xl border-l border-y border-white/10 shadow-2xl overflow-hidden backdrop-blur-xl relative">
      {/* Premium Glassmorphic Header */}
      <header className="flex justify-between items-center px-4 py-3 bg-white/5 border-b border-white/10 select-none flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsHistoryOpen(!isHistoryOpen)}
            className="p-1.5 bg-white/5 border border-white/10 rounded-lg text-white/50 hover:bg-white/10 hover:text-white transition-all cursor-pointer mr-1"
            title="Conversation history"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>
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
      <main 
        ref={mainRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4 custom-scrollbar flex flex-col"
      >
        {/* Dynamic State HUD Messages */}
        {!croppedImage && !loading && (
          <div className="flex flex-col items-center justify-center my-auto text-center space-y-3 py-10">
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
          <div className="flex gap-3 bg-white/5 border border-white/10 rounded-xl p-3 items-center backdrop-blur shadow-sm flex-shrink-0">
            <div className="w-24 max-h-16 rounded border border-white/10 bg-black/40 overflow-hidden flex-shrink-0 flex items-center justify-center">
              <img src={croppedImage} alt="Cropped regional selection" className="object-contain w-full h-full max-h-16" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-center">
                <span className="text-[10px] uppercase font-bold text-white/40 tracking-wider">Extracted Region</span>
                {ocrText && (
                  <button
                    onClick={() => handleCopyText(ocrText)}
                    className="text-[10px] text-blue-400 hover:text-blue-300 font-semibold uppercase tracking-wider flex items-center gap-1 cursor-pointer"
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
              ) : loading && messages.length === 0 ? (
                <div className="h-6 mt-1 flex items-center">
                  <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-white/40 ml-2 animate-pulse">
                    {config?.ocr.mode === "llm_multimodal" 
                      ? "Tutor reading image directly..." 
                      : "Processing capture..."}
                  </span>
                </div>
              ) : messages.length > 1 ? (
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
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-red-400 text-xs flex gap-2.5 items-start flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="font-semibold">Pipeline Error</p>
              <p className="text-white/60 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Conversation Chat Feed */}
        {messages.length > 0 && (
          <div className="flex-1 space-y-4 flex flex-col">
            {messages.map((msg, idx) => {
              // Hide the initial hidden system instructions block from feed view to avoid duplicate reading
              const isInitialUserPrompt = idx === 0 && msg.role === "user";
              if (isInitialUserPrompt) return null;

              return (
                <div 
                  key={idx} 
                  className={`p-4 rounded-xl border backdrop-blur shadow-sm space-y-1.5 flex flex-col ${
                    msg.role === "user"
                      ? "bg-indigo-500/10 border-indigo-500/20 text-indigo-100 self-end ml-10 max-w-[90%]"
                      : "bg-white/5 border-white/10 text-white/90"
                  }`}
                >
                  <div className="flex justify-between items-center pb-1 border-b border-white/5 mb-1 flex-shrink-0">
                    <span className="text-[9px] uppercase font-black text-white/35 tracking-wider">
                      {msg.role === "user" ? "You (Follow-up)" : "AIna-sensei"}
                    </span>
                  </div>

                  {msg.role === "assistant" ? (
                    <div className="text-sm overflow-hidden leading-relaxed">
                      {msg.content ? (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={markdownComponents}
                        >
                          {cleanExplanation(msg.content)}
                        </ReactMarkdown>
                      ) : (
                        /* Shimmer loading feedback while AI is processing the output chunk */
                        <div className="space-y-2 py-2">
                          <div className="h-4 bg-white/10 rounded animate-pulse w-3/4" />
                          <div className="h-4 bg-white/10 rounded animate-pulse w-5/6" />
                          <div className="h-4 bg-white/10 rounded animate-pulse w-2/3" />
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm leading-relaxed whitespace-pre-wrap font-medium">
                      {msg.content}
                    </p>
                  )}
                </div>
              );
            })}
            
            <div ref={contentEndRef} />
          </div>
        )}
      </main>

      {/* Sticky Chat Input Footer */}
      {croppedImage && messages.length > 1 && (
        <form onSubmit={handleSendMessage} className="px-4 py-3 bg-white/5 border-t border-white/10 flex-shrink-0 flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            rows={1}
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            placeholder={loading ? "Tutor is writing..." : "Ask AIna-sensei to explain further..."}
            className="flex-1 bg-black/40 border border-white/15 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm text-white outline-none transition-all placeholder:text-white/30 resize-none max-h-[140px] overflow-y-auto custom-scrollbar leading-5"
          />
          <button
            type="submit"
            disabled={loading || !chatInput.trim()}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white p-2.5 rounded-xl transition-all active:scale-95 flex items-center justify-center flex-shrink-0 cursor-pointer shadow-md shadow-indigo-500/10 mb-0.5"
            title="Send follow-up question"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 transform rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9-2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </form>
      )}

      {/* Backdrop overlay for drawer */}
      {isHistoryOpen && (
        <div 
          onClick={() => setIsHistoryOpen(false)}
          className="absolute inset-0 z-30 bg-black/40 backdrop-blur-sm transition-all"
        />
      )}

      {/* Sliding History Drawer */}
      <div 
        className={`absolute top-0 bottom-0 left-0 z-40 w-64 bg-slate-905 border-r border-white/10 shadow-2xl flex flex-col transition-transform duration-300 ${
          isHistoryOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex justify-between items-center px-4 py-3 bg-white/5 border-b border-white/10 flex-shrink-0 select-none">
          <h3 className="text-xs font-bold uppercase tracking-wider text-white/70">History</h3>
          <button 
            type="button"
            onClick={() => setIsHistoryOpen(false)}
            className="text-white/40 hover:text-white/70 transition-all text-xs font-semibold cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="p-3 border-b border-white/5 flex-shrink-0">
          <button
            onClick={startNewConversation}
            className="w-full bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-300 hover:text-indigo-200 text-xs font-semibold py-2 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            New Explanation
          </button>
        </div>

        {/* History Scrollable List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
          {conversationsList.length === 0 ? (
            <div className="text-center text-white/30 text-xs py-8 italic">
              No recent explanations
            </div>
          ) : (
            conversationsList.map((conv) => (
              <div
                key={conv.id}
                onClick={() => selectConversation(conv.id)}
                className={`group flex justify-between items-center p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                  activeConvId === conv.id
                    ? "bg-indigo-600/10 border-indigo-500/30 text-white"
                    : "bg-white/5 border-white/5 text-white/70 hover:bg-white/10 hover:border-white/10 hover:text-white"
                }`}
              >
                <div className="min-w-0 flex-1 pr-2">
                  <h4 className="text-xs font-semibold truncate leading-tight font-japanese">
                    {conv.title}
                  </h4>
                  <p className="text-[10px] text-white/35 truncate mt-0.5 font-normal leading-normal">
                    {conv.snippet || "No messages"}
                  </p>
                  <span className="text-[8px] text-white/20 block mt-1 font-mono">
                    {new Date(conv.timestamp).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </span>
                </div>
                <button
                  onClick={(e) => deleteConv(e, conv.id)}
                  className="text-white/20 hover:text-red-400 p-1.5 rounded-lg hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 flex-shrink-0 cursor-pointer"
                  title="Delete conversation"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
