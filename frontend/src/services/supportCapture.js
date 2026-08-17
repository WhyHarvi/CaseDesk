let latestCapture = null;
let capturePromise = null;
let lastCaptureAt = 0;

const safePath = () => window.location.pathname.slice(0, 500);

export function latestSupportCapture() {
  return latestCapture;
}

export function clearSupportCapture() {
  latestCapture = null;
}

export async function captureSupportFailure(error = {}) {
  if (Date.now() - lastCaptureAt < 10_000) return capturePromise;
  lastCaptureAt = Date.now();
  const context = {
    pagePath: safePath(),
    errorCode: String(error.code || error.name || "APPLICATION_ERROR").slice(0, 120),
    errorMessage: String(error.message || "The page encountered an unexpected error.").slice(0, 1000),
    diagnostics: {
      browser: navigator.userAgent.slice(0, 300),
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      occurredAt: new Date().toISOString(),
      requestId: String(error.requestId || "").slice(0, 120),
      status: Number(error.status) || null,
    },
  };
  const eventDetail = {
    automatic: error.code !== "USER_REPORTED",
    notify: error.notify !== false,
  };
  capturePromise = import("html2canvas")
    .then(({ default: html2canvas }) => html2canvas(document.body, {
      backgroundColor: "#f8fafc",
      logging: false,
      scale: Math.min(window.devicePixelRatio || 1, 1.5),
      useCORS: true,
      onclone: (documentClone) => {
        documentClone.querySelectorAll("input, textarea, [data-support-private], canvas").forEach((element) => {
          element.style.filter = "blur(8px)";
        });
      },
    }))
    .then((canvas) => new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.78)))
    .then((blob) => {
      latestCapture = { ...context, blob: blob || null };
      window.dispatchEvent(new CustomEvent("casedesk:support-captured", { detail: eventDetail }));
      return latestCapture;
    })
    .catch(() => {
      latestCapture = { ...context, blob: null };
      window.dispatchEvent(new CustomEvent("casedesk:support-captured", { detail: eventDetail }));
      return latestCapture;
    });
  return capturePromise;
}

export async function captureCurrentPageForSupport() {
  lastCaptureAt = 0;
  return captureSupportFailure({ code: "USER_REPORTED", message: "User initiated a support report." });
}
