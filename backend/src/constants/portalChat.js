// Sentinel caseId for the client portal's case-less "general inquiry"
// chat. Shared between portalController.js (which resolves it into an
// actual conversation with caseId: null) and the requireClientPortalPermission
// middleware (which must not treat it as a real case id to look up).
export const GENERAL_CHAT_ID = "general";
