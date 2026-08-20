import prisma from "../services/prisma/client.js";
import { dispatchActivityNotification } from "../services/notificationService.js";
import { createHttpError } from "./http.js";

function normalizeEmpty(value) {
  return value === "" ? null : value;
}

function stringField(value) {
  return normalizeEmpty(value);
}

function dateField(value, fieldName) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === "") {
    return null;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw createHttpError(400, `Invalid date for ${fieldName}`);
  }

  return parsed;
}

function booleanField(value, fieldName) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw createHttpError(400, `Invalid boolean for ${fieldName}`);
}

function decimalField(value, fieldName) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === "") {
    return null;
  }

  const parsed = Number(value);

  if (Number.isNaN(parsed)) {
    throw createHttpError(400, `Invalid number for ${fieldName}`);
  }

  return parsed;
}

function enumField(values) {
  const allowed = new Set(values);

  return (value, fieldName) => {
    if (value === undefined) {
      return undefined;
    }

    if (value === null || value === "") {
      return null;
    }

    if (!allowed.has(value)) {
      throw createHttpError(400, `Invalid value for ${fieldName}`);
    }

    return value;
  };
}

function relationField(value) {
  return value === "" ? null : value;
}

function pickBody(body, fieldConfig) {
  const data = {};

  for (const [fieldName, parser] of Object.entries(fieldConfig)) {
    if (Object.prototype.hasOwnProperty.call(body, fieldName)) {
      data[fieldName] = parser ? parser(body[fieldName], fieldName) : body[fieldName];
    }
  }

  return data;
}

function withAgencyScope(req, extraWhere = {}) {
  return {
    agencyId: req.user.agencyId,
    ...extraWhere,
  };
}

function parsePagination(query) {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 100);

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
}

export async function recordActivity({
  agencyId,
  userId,
  clientId = null,
  caseId = null,
  action,
  details = null,
  entityType = null,
  entityId = null,
  metadata = {},
}) {
  try {
    let resolvedClientId = clientId;

    // Many case-level actions only know the case id. Resolve its client here
    // so the same audit row is visible both on the case and on the client's
    // complete activity timeline. This also keeps future activity consistent
    // without every controller having to remember to pass clientId manually.
    if (!resolvedClientId && caseId) {
      const caseRecord = await prisma.case.findFirst({
        where: { id: caseId, agencyId },
        select: { clientId: true },
      });
      resolvedClientId = caseRecord?.clientId || null;
    }

    const activity = await prisma.activityLog.create({
      data: {
        agencyId,
        userId,
        clientId: resolvedClientId,
        caseId,
        action,
        details,
        entityType: entityType || (caseId ? "case" : resolvedClientId ? "client" : "user"),
        entityId: entityId || caseId || resolvedClientId || userId,
        metadata,
      },
    });
    try {
      await dispatchActivityNotification(activity);
    } catch (error) {
      if (process.env.NODE_ENV !== "test") {
        console.error("Failed to create activity notification", error);
      }
    }
    return activity;
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.error("Failed to write activity log", error);
    }
  }
}

export function createCrudController({
  model,
  label,
  createFields,
  updateFields = createFields,
  include,
  orderBy = { createdAt: "desc" },
  buildListWhere,
  buildAccessWhere,
  afterCreate,
  afterUpdate,
  afterDelete,
  activityEntity,
  activityDetails,
}) {
  const prismaModel = prisma[model];

  if (!prismaModel) {
    throw new Error(`Prisma model ${model} is not available`);
  }

  return {
    async list(req, res) {
      const { page, limit, skip } = parsePagination(req.query);
      const where = withAgencyScope(req, {
        ...(buildAccessWhere ? buildAccessWhere(req) : {}),
        ...(buildListWhere ? buildListWhere(req) : {}),
      });

      const [data, total] = await Promise.all([
        prismaModel.findMany({
          where,
          include,
          orderBy,
          skip,
          take: limit,
        }),
        prismaModel.count({ where }),
      ]);

      res.json({
        data,
        meta: {
          page,
          limit,
          total,
        },
      });
    },

    async getById(req, res) {
      const data = await prismaModel.findFirst({
        where: withAgencyScope(req, { id: req.params.id, ...(buildAccessWhere ? buildAccessWhere(req) : {}) }),
        include,
      });

      if (!data) {
        throw createHttpError(404, `${label} not found`);
      }

      res.json({ data });
    },

    async create(req, res) {
      const payload = pickBody(req.body, createFields);
      const data = await prismaModel.create({
        data: {
          ...payload,
          agencyId: req.user.agencyId,
        },
        include,
      });

      if (afterCreate) {
        await afterCreate({ req, data });
      }

      if (activityEntity) {
        await recordActivity({
          agencyId: req.user.agencyId,
          userId: req.user.id,
          clientId: data.clientId ?? null,
          caseId: data.caseId ?? null,
          action: `${activityEntity}.created`,
          details: activityDetails ? activityDetails("created", data) : `${label} created`,
        });
      }

      res.status(201).json({ data });
    },

    async update(req, res) {
      const existing = await prismaModel.findFirst({
        where: withAgencyScope(req, { id: req.params.id, ...(buildAccessWhere ? buildAccessWhere(req) : {}) }),
      });

      if (!existing) {
        throw createHttpError(404, `${label} not found`);
      }

      const payload = pickBody(req.body, updateFields);
      const data = await prismaModel.update({
        where: { id: req.params.id },
        data: payload,
        include,
      });

      if (afterUpdate) {
        await afterUpdate({ req, existing, data });
      }

      if (activityEntity) {
        await recordActivity({
          agencyId: req.user.agencyId,
          userId: req.user.id,
          clientId: data.clientId ?? existing.clientId ?? null,
          caseId: data.caseId ?? existing.caseId ?? null,
          action: `${activityEntity}.updated`,
          details: activityDetails ? activityDetails("updated", data) : `${label} updated`,
        });
      }

      res.json({ data });
    },

    async remove(req, res) {
      const existing = await prismaModel.findFirst({
        where: withAgencyScope(req, { id: req.params.id, ...(buildAccessWhere ? buildAccessWhere(req) : {}) }),
      });

      if (!existing) {
        throw createHttpError(404, `${label} not found`);
      }

      await prismaModel.delete({
        where: { id: req.params.id },
      });

      if (afterDelete) {
        await afterDelete({ req, existing });
      }

      if (activityEntity) {
        await recordActivity({
          agencyId: req.user.agencyId,
          userId: req.user.id,
          clientId: existing.clientId ?? null,
          caseId: existing.caseId ?? null,
          action: `${activityEntity}.deleted`,
          details: activityDetails ? activityDetails("deleted", existing) : `${label} deleted`,
        });
      }

      res.status(204).send();
    },
  };
}

export const fieldParsers = {
  stringField,
  dateField,
  booleanField,
  decimalField,
  enumField,
  relationField,
};
