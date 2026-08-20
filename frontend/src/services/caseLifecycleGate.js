let lifecyclePrompt = null;

export function registerCaseLifecyclePrompt(handler) {
  lifecyclePrompt = handler;
  return () => {
    if (lifecyclePrompt === handler) lifecyclePrompt = null;
  };
}

export function requestCaseLifecycleInput(request) {
  if (!lifecyclePrompt) {
    return Promise.reject(new Error("Case lifecycle form is not ready. Refresh the page and try again."));
  }
  return lifecyclePrompt(request);
}
