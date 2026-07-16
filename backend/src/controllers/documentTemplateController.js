import prisma from "../services/prisma/client.js";
import { buildDocumentProgramCatalog } from "../services/documentProgramCatalog.js";
import { createCrudController, fieldParsers } from "../utils/prismaCrud.js";

const fields = {
  caseType: fieldParsers.stringField,
  documentName: fieldParsers.stringField,
  isRequired: fieldParsers.booleanField,
};

const controller = createCrudController({
  model: "documentTemplate",
  label: "Document template",
  createFields: fields,
  updateFields: fields,
  buildListWhere: (req) => ({
    ...(req.query.caseType ? { caseType: req.query.caseType } : {}),
  }),
  activityEntity: "document_template",
});

export async function listDocumentProgramCatalog(req, res) {
  const agencyTemplates = await prisma.documentTemplate.findMany({
    where: { agencyId: req.user.agencyId },
    orderBy: [{ caseType: "asc" }, { createdAt: "asc" }],
  });
  const search = String(req.query.q || "").trim().toLowerCase();
  const catalog = buildDocumentProgramCatalog(agencyTemplates);
  const data = search
    ? catalog.filter((program) =>
        [program.title, program.category, ...program.aliases]
          .join(" ")
          .toLowerCase()
          .includes(search),
      )
    : catalog;

  res.json({
    data,
    meta: {
      total: data.length,
      disclaimer:
        "Starter checklists must be reviewed against the applicant's personalized IRCC checklist and current program instructions.",
    },
  });
}

export const listDocumentTemplates = controller.list;
export const getDocumentTemplateById = controller.getById;
export const createDocumentTemplate = controller.create;
export const updateDocumentTemplate = controller.update;
export const deleteDocumentTemplate = controller.remove;

export default controller;
