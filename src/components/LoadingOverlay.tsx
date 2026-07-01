import { Loader2 } from "lucide-react";

export function LoadingOverlay({
  loading,
  text = "加载中...",
}: {
  loading: boolean;
  text?: string;
}) {
  return (
    <div
      className={`absolute inset-0 z-20 flex flex-col items-center justify-center bg-white/60 dark:bg-zinc-950/60 backdrop-blur-sm rounded-xl transition-all ${
        loading ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
      }`}
      aria-hidden={!loading}
    >
      <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mb-2" />
      <span className="text-sm text-zinc-500 dark:text-zinc-400">{text}</span>
    </div>
  );
}
