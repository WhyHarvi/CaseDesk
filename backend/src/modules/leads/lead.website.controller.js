import * as service from "./lead.website.service.js";

export async function listConnections(req, res) { res.json({ data: await service.listWebsiteConnections(req) }); }
export async function createConnection(req, res) { res.status(201).json({ data: await service.createWebsiteConnection(req) }); }
export async function updateConnection(req, res) { res.json({ data: await service.updateWebsiteConnection(req) }); }
export async function rotateSecret(req, res) { res.json({ data: await service.rotateWebsiteSecret(req) }); }
export async function receiveEvent(req, res) { res.status(202).json({ data: await service.receiveWebsiteEvent(req) }); }
export async function listSourceConnections(req, res) { res.json({ data: await service.listSourceConnections(req) }); }
export async function createSourceConnection(req, res) { res.status(201).json({ data: await service.createSourceConnection(req) }); }
export async function updateSourceConnection(req, res) { res.json({ data: await service.updateSourceConnection(req) }); }
export async function rotateSourceConnectionSecret(req, res) { res.json({ data: await service.rotateSourceConnectionSecret(req) }); }
export async function verifyChallenge(req, res) { res.type("text/plain").send(await service.verifyProviderChallenge(req)); }
export async function receiveProviderEvent(req, res) {
  const data = await service.receiveProviderEvent(req);
  if (String(req.params.provider).toUpperCase() === "GOOGLE_ADS") return res.status(200).json({});
  return res.status(200).json({ data });
}
