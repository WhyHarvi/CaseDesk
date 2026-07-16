import prisma from "../services/prisma/client.js";

export function getDb() {
  return prisma;
}

export default getDb;

