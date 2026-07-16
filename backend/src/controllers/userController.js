import { createCrudController, fieldParsers } from "../utils/prismaCrud.js";

const include = {
  assignedClients: {
    select: {
      id: true,
      fullName: true,
      status: true,
    },
  },
};

const createFields = {
  fullName: fieldParsers.stringField,
  email: fieldParsers.stringField,
  role: fieldParsers.enumField(["admin", "staff"]),
  phone: fieldParsers.stringField,
  jobTitle: fieldParsers.stringField,
  licenseNumber: fieldParsers.stringField,
};

const controller = createCrudController({
  model: "user",
  label: "User",
  createFields,
  updateFields: createFields,
  include,
  activityEntity: "user",
});

export const listUsers = controller.list;
export const getUserById = controller.getById;
export const createUser = controller.create;
export const updateUser = controller.update;
export const deleteUser = controller.remove;

export default controller;
