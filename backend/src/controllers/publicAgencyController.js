import prisma from "../services/prisma/client.js";
import { AVATAR_BUCKET, downloadStorageFile } from "../services/supabaseStorage.js";
import { createHttpError } from "../utils/http.js";

// The agency's workspace-profile picture (Settings > Workspace Profile),
// served without authentication — needed because it's embedded directly as
// an <img> inside retainer/agreement HTML that can be opened in contexts
// with no CaseDesk session at all: a signed/downloaded document file, or a
// portal document viewer sandboxed enough that authenticated requests
// wouldn't carry credentials. A company logo isn't sensitive, and the
// agency id in the URL is a UUID, not an enumerable slug.
export async function getPublicAgencyLogo(req, res) {
  const agency = await prisma.agency.findUnique({
    where: { id: req.params.agencyId },
    select: { avatarStorageKey: true, avatarMimeType: true },
  });
  if (!agency?.avatarStorageKey) throw createHttpError(404, "No workspace logo is available.", "NOT_FOUND");
  const buffer = await downloadStorageFile(AVATAR_BUCKET, agency.avatarStorageKey, { allowMissing: true });
  if (!buffer) throw createHttpError(404, "The workspace logo could not be found.", "NOT_FOUND");
  res.set("Cache-Control", "public, max-age=3600");
  res.type(agency.avatarMimeType || "application/octet-stream");
  res.send(buffer);
}
