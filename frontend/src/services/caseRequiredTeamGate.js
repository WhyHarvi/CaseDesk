let requiredTeamPrompt = null;

export function registerRequiredCaseTeamPrompt(handler) {
  requiredTeamPrompt = handler;
  return () => {
    if (requiredTeamPrompt === handler) requiredTeamPrompt = null;
  };
}

export function requestRequiredCaseTeam(request) {
  if (!requiredTeamPrompt) {
    return Promise.reject(new Error("Required case team form is not ready. Refresh the page and try again."));
  }
  return requiredTeamPrompt(request);
}
