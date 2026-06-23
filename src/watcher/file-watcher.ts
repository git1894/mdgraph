import chokidar, { type FSWatcher } from "chokidar";
import { loadConfig } from "../config/load-config.js";
import { indexProject, type IndexResult } from "../indexer.js";
import { resolveIgnorePatterns } from "../scanner/file-scanner.js";

export interface WatchProjectOptions {
  debounceMs?: number;
  semantic?: boolean;
  onIndexed?: (result: IndexResult) => void;
  onError?: (error: Error) => void;
}

export interface WatchHandle {
  close: () => Promise<void>;
}

export async function watchProject(projectRoot: string, options: WatchProjectOptions = {}): Promise<WatchHandle> {
  const config = loadConfig(projectRoot);
  const ignored = await resolveIgnorePatterns(projectRoot, config);
  const debounceMs = options.debounceMs ?? 250;
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let queued = false;
  let closed = false;
  let activeIndex: Promise<void> | undefined;

  const runIndex = async (): Promise<void> => {
    if (closed) {
      return;
    }
    if (running) {
      queued = true;
      await activeIndex;
      return;
    }
    running = true;
    activeIndex = (async () => {
      try {
        const result = await indexProject(projectRoot, { semantic: options.semantic });
        options.onIndexed?.(result);
      } catch (error) {
        notifyError(options.onError, error);
      } finally {
        running = false;
        activeIndex = undefined;
        if (!closed && queued) {
          queued = false;
          scheduleIndex();
        }
      }
    })();
    await activeIndex;
  };

  const scheduleIndex = (): void => {
    if (closed) {
      return;
    }
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      void runIndex();
    }, debounceMs);
  };

  const watcher: FSWatcher = chokidar.watch(".", {
    cwd: projectRoot,
    ignored,
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 }
  });

  watcher.on("add", scheduleIndex);
  watcher.on("change", scheduleIndex);
  watcher.on("unlink", scheduleIndex);
  watcher.on("error", (error) => {
    notifyError(options.onError, error);
  });

  try {
    await waitForReady(watcher);
    await runIndex();
  } catch (error) {
    closed = true;
    await watcher.close();
    throw error;
  }

  return {
    close: async () => {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      try {
        if (activeIndex) {
          await activeIndex;
        }
      } finally {
        await watcher.close();
      }
    }
  };
}

function notifyError(onError: WatchProjectOptions["onError"], error: unknown): void {
  try {
    onError?.(error instanceof Error ? error : new Error(String(error)));
  } catch {
    // User callbacks must not break watcher cleanup or future indexing.
  }
}

function waitForReady(watcher: FSWatcher): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      watcher.off("ready", onReady);
      watcher.off("error", onError);
    };
    const onReady = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: unknown): void => {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    watcher.once("ready", onReady);
    watcher.once("error", onError);
  });
}