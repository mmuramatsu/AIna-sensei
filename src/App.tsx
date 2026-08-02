import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Settings } from "./components/Settings";
import { Snipper } from "./components/Snipper";
import { Hud } from "./components/Hud";
import "./App.css";

function App() {
  const [windowLabel, setWindowLabel] = useState<string | null>(null);

  useEffect(() => {
    try {
      const label = getCurrentWindow().label;
      setWindowLabel(label);
    } catch (err) {
      console.error("Failed to determine window label:", err);
      setWindowLabel("main"); // Default fallback
    }
  }, []);

  if (windowLabel === "snipper") {
    return <Snipper />;
  }

  if (windowLabel === "hud") {
    return <Hud />;
  }

  if (windowLabel === "main") {
    return <Settings />;
  }

  return (
    <div className="w-screen h-screen flex flex-col items-center justify-center bg-slate-950 text-white">
      <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-xs text-white/50 mt-3 animate-pulse">Launching Tutor...</p>
    </div>
  );
}

export default App;
