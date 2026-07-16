import { createCrudController, fieldParsers } from "../utils/prismaCrud.js";
import { relatedRecordAccessWhere } from "../middleware/authorization.js";

const include = {
  user: {
    select: {
      id: true,
      fullName: true,
      email: true,
    },
  },
  client: {
    select: {
      id: true,
      fullName: true,
    },
  },
  case: {
    select: {
      id: true,
      caseType: true,
      stage: true,
    },
  },
};

const fields = {
  userId: fieldParsers.relationField,
  clientId: fieldParsers.relationField,
  caseId: fieldParsers.relationField,
  action: fieldParsers.stringField,
  details: fieldParsers.stringField,
};

const controller = createCrudController({
  model: "activityLog",
  label: "Activity log",
  createFields: fields,
  updateFields: fields,
  include,
  buildAccessWhere: relatedRecordAccessWhere,
  buildListWhere: (req) => ({
    ...(req.query.userId ? { userId: req.query.userId } : {}),
    ...(req.query.clientId ? { clientId: req.query.clientId } : {}),
    ...(req.query.caseId ? { caseId: req.query.caseId } : {}),
    ...(req.query.action ? { action: req.query.action } : {}),
  }),
});

export const listActivityLogs = controller.list;
export const getActivityLogById = controller.getById;
export const createActivityLog = controller.create;
export const updateActivityLog = controller.update;
export const deleteActivityLog = controller.remove;

export default controller;
