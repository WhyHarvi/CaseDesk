import { lazy } from "react";

const RECOVERY_PREFIX = "casedesk.lazy-recovery";

function isModuleLoadFailure(error) {
  const message = String(error?.message || error || "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk|Unable to preload CSS|dynamically imported module|Page module load timed out/i.test(
    message,
  );
}

function recoveryKey(label) {
  return `${RECOVERY_PREFIX}:${label}`;
}

function reloadWithFreshAssets() {
  const url = new URL(window.location.href);
  url.searchParams.set("__casedesk_recover", Date.now().toString());
  window.location.replace(url.toString());
}

/**
 * Loads a split page normally, but performs one clean reload when the browser
 * has a stale or interrupted page bundle. A successful load clears the guard,
 * so a later genuine deployment can recover in the same browser session.
 */
export function lazyWithRetry(loader, label) {
  return lazy(async () => {
    const key = recoveryKey(label);
    let timeout;
    try {
      const module = await Promise.race([
        loader(),
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Page module load timed out")),
            25_000,
          );
        }),
      ]);
      clearTimeout(timeout);
      try {
        sessionStorage.removeItem(key);
      } catch {
        // Session storage is an optimization, not a requirement.
      }
      return module;
    } catch (error) {
      clearTimeout(timeout);
      if (typeof window !== "undefined" && isModuleLoadFailure(error)) {
        let alreadyRetried = false;
        try {
          alreadyRetried = sessionStorage.getItem(key) === "1";
          if (!alreadyRetried) sessionStorage.setItem(key, "1");
        } catch {
          // If storage is unavailable, the recovery screen handles the error.
          alreadyRetried = true;
        }
        if (!alreadyRetried) {
          reloadWithFreshAssets();
          return new Promise(() => {});
        }
      }
      throw error;
    }
  });
}
