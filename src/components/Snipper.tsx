import { useEffect, useState, MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { emit } from "@tauri-apps/api/event";

export function Snipper() {
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [selection, setSelection] = useState({
    startX: 0,
    startY: 0,
    currX: 0,
    currY: 0,
    active: false,
    hasMoved: false,
  });

  const loadScreenshot = async () => {
    try {
      const img = await invoke<string>("get_captured_screen");
      setBgImage(img);
    } catch (err) {
      console.error("Failed to load screenshot:", err);
    }
  };

  useEffect(() => {
    // Initial load
    loadScreenshot();

    // Listen for event from Rust when the global hotkey triggers
    const unlistenPromise = listen("start-snipping", () => {
      loadScreenshot();
      setSelection({ startX: 0, startY: 0, currX: 0, currY: 0, active: false, hasMoved: false });
    });

    // Close overlay on Escape key
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        await invoke("hide_window", { label: "snipper" });
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Only left click
    setSelection({
      startX: e.clientX,
      startY: e.clientY,
      currX: e.clientX,
      currY: e.clientY,
      active: true,
      hasMoved: false,
    });
  };

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!selection.active) return;
    setSelection((prev) => ({
      ...prev,
      currX: e.clientX,
      currY: e.clientY,
      hasMoved: true,
    }));
  };

  const handleMouseUp = async () => {
    if (!selection.active) return;
    setSelection((prev) => ({ ...prev, active: false }));

    const x = Math.min(selection.startX, selection.currX);
    const y = Math.min(selection.startY, selection.currY);
    const w = Math.abs(selection.startX - selection.currX);
    const h = Math.abs(selection.startY - selection.currY);

    if (w < 10 || h < 10) {
      // Click was too small, cancel to prevent accidental crops
      await invoke("hide_window", { label: "snipper" });
      return;
    }

    try {
      // Crop image on backend
      const croppedBase64 = await invoke<string>("crop_image", { x, y, w, h });
      
      // Hide snipper immediately for seamless workflow
      await invoke("hide_window", { label: "snipper" });
      
      // Broadcast explaining request to HUD overlay
      await emit("explain-image", { image: croppedBase64 });
      
      // Display the HUD overlay
      await invoke("show_window", { label: "hud" });
    } catch (err) {
      console.error("Failed to crop/emit selection:", err);
      await invoke("hide_window", { label: "snipper" });
    }
  };

  // Dimensions of the selection rectangle
  const rectX = Math.min(selection.startX, selection.currX);
  const rectY = Math.min(selection.startY, selection.currY);
  const rectW = Math.abs(selection.startX - selection.currX);
  const rectH = Math.abs(selection.startY - selection.currY);

  return (
    <div
      className="relative w-screen h-screen select-none overflow-hidden cursor-crosshair"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{
        backgroundImage: bgImage ? `url(${bgImage})` : "none",
        backgroundSize: "cover",
      }}
    >
      {/* Dim overlay with SVG mask */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        <defs>
          <mask id="snipper-mask">
            {/* White covers the entire screen (keeps dimming) */}
            <rect width="100%" height="100%" fill="white" />
            {/* Black cuts a hole in the mask (shows clear background) */}
            {selection.active && selection.hasMoved && (
              <rect
                x={rectX}
                y={rectY}
                width={rectW}
                height={rectH}
                fill="black"
              />
            )}
          </mask>
        </defs>

        {/* Dim layer */}
        <rect
          width="100%"
          height="100%"
          fill="rgba(0, 0, 0, 0.45)"
          mask="url(#snipper-mask)"
        />

        {/* Highlight border around selection */}
        {selection.active && selection.hasMoved && (
          <rect
            x={rectX}
            y={rectY}
            width={rectW}
            height={rectH}
            fill="none"
            stroke="#3b82f6"
            strokeWidth="2"
            strokeDasharray="4 2"
          />
        )}
      </svg>

      {/* Guide Help Toast */}
      {!selection.active && (
        <div className="absolute bottom-10 left-1/2 transform -translate-x-1/2 bg-black/85 text-white/90 px-6 py-3 rounded-full text-sm font-medium tracking-wide shadow-2xl backdrop-blur border border-white/10 animate-fade-in pointer-events-none">
          Click and drag to select text • Press <kbd className="bg-white/15 px-1.5 py-0.5 rounded text-xs font-mono">Esc</kbd> to cancel
        </div>
      )}
    </div>
  );
}
