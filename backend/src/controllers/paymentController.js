import { createCrudController, fieldParsers } from "../utils/prismaCrud.js";
import { relatedRecordAccessWhere } from "../middleware/authorization.js";

const include = {
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
  clientId: fieldParsers.relationField,
  caseId: fieldParsers.relationField,
  totalFee: fieldParsers.decimalField,
  paidAmount: fieldParsers.decimalField,
  balance: fieldParsers.decimalField,
  status: fieldParsers.enumField(["Unpaid", "Partial", "Paid", "Refunded"]),
  currency: fieldParsers.stringField,
  notes: fieldParsers.stringField,
};

const controller = createCrudController({
  model: "payment",
  label: "Payment",
  createFields: fields,
  updateFields: fields,
  include,
  buildAccessWhere: relatedRecordAccessWhere,
  buildListWhere: (req) => ({
    ...(req.query.clientId ? { clientId: req.query.clientId } : {}),
    ...(req.query.caseId ? { caseId: req.query.caseId } : {}),
    ...(req.query.status ? { status: req.query.status } : {}),
  }),
  activityEntity: "payment",
});

export const listPayments = controller.list;
export const getPaymentById = controller.getById;
export const createPayment = controller.create;
export const updatePayment = controller.update;
export const deletePayment = controller.remove;

export default controller;
