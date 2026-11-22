import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useTransferStore, type TransferTask } from "../store/transfer";

type ProgressEvent = {
  task_id: string;
  total_size: number;
  progress: number;
  status: string;
  error?: string;
  uploaded_size?: number;
  downloaded_size?: number;
};

const pending = new Map<string, Partial<TransferTask>>();
let frame = 0;
let subscription: Promise<void> | undefined;

function flush() {
  frame = 0;
  useTransferStore.getState().batchUpdateTasks(new Map(pending));
  pending.clear();
}

function handleProgress({ payload }: { payload: ProgressEvent }) {
  const task = useTransferStore.getState().tasksById[payload.task_id];
  if (!task) return;
  const { task_id, total_size, progress, status, error, uploaded_size, downloaded_size } = payload;
  const terminal = status === "completed" || status === "failed" || status === "cancelled" || status === "skipped";
  if (!terminal && task.status !== "pending" && task.status !== "transferring") return;
  pending.set(task_id, {
    transferredSize: uploaded_size ?? downloaded_size ?? 0,
    progress,
    status: terminal ? status : "transferring",
    error,
    ...(total_size > 0 ? { totalSize: total_size } : {}),
    ...(terminal ? { endTime: Date.now() } : {}),
  });
  if (terminal) {
    if (frame) cancelAnimationFrame(frame);
    flush();
  } else if (!frame) {
    frame = requestAnimationFrame(flush);
  }
}

/** Subscribe once for the lifetime of the window, before starting transfers. */
export function ensureTransferEvents() {
  subscription ??= (async () => {
    let unlistenUpload: UnlistenFn | undefined;
    try {
      unlistenUpload = await listen<ProgressEvent>("upload-progress", handleProgress);
      await listen<ProgressEvent>("download-progress", handleProgress);
    } catch (error) {
      unlistenUpload?.();
      subscription = undefined;
      throw error;
    }
  })();
  return subscription;
}

export function failActiveTransfers(ids: string[], error: unknown) {
  const store = useTransferStore.getState();
  const patches = new Map<string, Partial<TransferTask>>();
  for (const id of ids) {
    const status = store.tasksById[id]?.status;
    if (status === "pending" || status === "transferring") {
      pending.delete(id);
      patches.set(id, { status: "failed", error: String(error), endTime: Date.now() });
    }
  }
  store.batchUpdateTasks(patches);
}
