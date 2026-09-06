import { useState, lazy, Suspense } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";

const Settings = lazy(() => import("./components/Settings").then(m => ({ default: m.Settings })));
const Snipper = lazy(() => import("./components/Snipper").then(m => ({ default: m.Snipper })));
const Hud = lazy(() => import("./components/Hud").then(m => ({ default: m.Hud })));

function App() {
  const [windowLabel] = useState<string>(() => {
    try {
      return getCurrentWindow().label;
    } catch {
      return "main";
    }
  });

  const LoadingFallback = (
    <div className="w-screen h-screen flex flex-col items-center justify-center bg-slate-950 text-white">
      <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-xs text-white/50 mt-3 animate-pulse">Launching Tutor...</p>
    </div>
  );

  if (windowLabel === "snipper") {
    return <Suspense fallback={LoadingFallback}><Snipper /></Suspense>;
  }

  if (windowLabel === "hud") {
    return <Suspense fallback={LoadingFallback}><Hud /></Suspense>;
  }

  return <Suspense fallback={LoadingFallback}><Settings /></Suspense>;
}

export default App;
