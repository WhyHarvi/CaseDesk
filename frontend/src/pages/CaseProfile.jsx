import { Archive, ArchiveRestore, ArrowUpRight, FolderCheck, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import AssessmentOverlay from "../components/case-profile/AssessmentOverlay";
import CaseWorkspaceTabs from "../components/case-profile/CaseWorkspaceTabs";
import {
  CaseProfileToolbar,
  CaseProfileTopSection,
} from "../components/case-profile/CaseProfileSummary";
import {
  WorkflowOverlay,
  WorkflowTemplateCreateOverlay,
} from "../components/case-profile/WorkflowEditorOverlay";
import WorkflowTimeline from "../components/case-profile/WorkflowTimeline";
import TimelineProgressStrip from "../components/incentives/TimelineProgressStrip";
import { normalizeDocumentName } from "../components/case-profile/documentNames";
import ApplicantsOverlay from "../components/case-profile/applicants/ApplicantsOverlay";
import DownloadApplicationOverlay from "../components/case-profile/DownloadApplicationOverlay";
import NotesOverlay from "../components/case-profile/notes/NotesOverlay";
import ActivitiesOverlay from "../components/case-profile/activities/ActivitiesOverlay";
import StatementOfAccountOverlay from "../components/statements/StatementOfAccountOverlay";
import CommunicationSetupOverlay from "../components/case-profile/communication/CommunicationSetupOverlay";
import CaseActionDialog from "../components/case-profile/CaseActionDialog";
import ESignCenterOverlay from "../components/case-profile/ESignCenterOverlay";
import CasePermissionsOverlay from "../components/case-profile/CasePermissionsOverlay";
import CaseRolesOverlay from "../components/case-profile/CaseRolesOverlay";
import RestrictedCaseAccess from "../components/case-profile/RestrictedCaseAccess";
import ClientEditDrawer from "../components/clients/ClientEditDrawer";
import { CaseFormDrawer, defaultCaseFormState, getDefaultNextAction } from "./Cases";
import { useAuth } from "../auth/AuthContext";
import { canAccessCaseTab, canAccessPage, hasCapability } from "../auth/portalAccess";
import {
  buildBlankTemplateStep,
  buildDraftStepFromTemplateStep,
  buildDraftStepFromWorkflowStep,
} from "../components/case-profile/workflowDrafts";
import PageContainer from "../components/layout/PageContainer";
import useNow from "../hooks/useNow";
import api from "../services/api";
import { caseStagesForType } from "../constants/caseStages";
import { isStudyPermitCaseType, studyIntakeApiValue, studyIntakeValue } from "../utils/studyIntake";

const TERMINAL_CASE_STATUSES = new Set(["Completed", "Closed", "Cancelled", "Inactive"]);
const CASE_RECOVERY_DELAYS_MS = [1_000, 2_500, 5_000, 10_000, 30_000];

function isRecoverableCaseLoadError(error) {
  const status = Number(error?.response?.status);
  return !status || status === 408 || status === 425 || status === 429 || status >= 500;
}

async function fetchAllCaseDocuments(caseId, fresh = false) {
  const get = fresh ? api.getFresh : api.get;
  const limit = 100;
  const documents = [];
  let page = 1;
  let total = Infinity;

  while (documents.length < total) {
    const response = await get(
      `/client-documents?caseId=${encodeURIComponent(caseId)}&page=${page}&limit=${limit}`,
    );
    const pageDocuments = Array.isArray(response.data.data)
      ? response.data.data
      : [];
    documents.push(...pageDocuments);
    total = Number(response.data.meta?.total ?? documents.length);
    if (!pageDocuments.length) break;
    page += 1;
  }

  return documents;
}

export default function CaseProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { role, membership } = useAuth();
  const canAccessInternalNotes = hasCapability(role, membership?.permissions, "internalNotes");
  const canAccessFinancialData = hasCapability(role, membership?.permissions, "financialData");
  const canManageClientPortal = hasCapability(role, membership?.permissions, "manageClientPortal");
  const canAccessCaseCommunication = canAccessCaseTab(role, membership?.permissions, "communication");
  const canAccessCaseForms = canAccessCaseTab(role, membership?.permissions, "forms");
  const canAccessCaseDocuments = canAccessCaseTab(role, membership?.permissions, "documents");
  // Frontdesk can view any case now, but managing applicants and
  // archiving/closing/deleting the case itself stays admin/consultant only
  // (enforced server-side in caseRoutes.js too).
  const canManageCase = ["admin", "consultant"].includes(role);
  const canAccessIncentives = canAccessPage(role, membership?.permissions, "incentives");
  const [caseItem, setCaseItem] = useState(null);
  const [restrictedCase, setRestrictedCase] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [paymentSummary, setPaymentSummary] = useState({ totalFee: 0, paidAmount: 0, balance: 0, status: "Unpaid" });
  const [followUps, setFollowUps] = useState([]);
  const [notes, setNotes] = useState([]);
  const [activityLogs, setActivityLogs] = useState([]);
  const [assessment, setAssessment] = useState(null);
  const [workflowSteps, setWorkflowSteps] = useState([]);
  const [workflowTemplates, setWorkflowTemplates] = useState([]);
  const [workflowLoadError, setWorkflowLoadError] = useState("");
  const [timelineProgress, setTimelineProgress] = useState(null);
  const timelineNow = useNow();
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);
  const [error, setError] = useState("");
  const mountedRef = useRef(false);
  const recoveryTimerRef = useRef(null);
  const recoveryAttemptRef = useRef(0);
  const loadGenerationRef = useRef(0);
  const [activeToolbarTray, setActiveToolbarTray] = useState("");
  const [downloadApplicationOverlayOpen, setDownloadApplicationOverlayOpen] = useState(false);
  const [assessmentOverlayOpen, setAssessmentOverlayOpen] = useState(false);
  const [applicantsOverlayOpen, setApplicantsOverlayOpen] = useState(false);
  const [closeCaseDialogOpen, setCloseCaseDialogOpen] = useState(false);
  const [closeBillingDisposition, setCloseBillingDisposition] = useState("keep_outstanding");
  const [closeBillingReason, setCloseBillingReason] = useState("");
  const [archiveCaseDialogOpen, setArchiveCaseDialogOpen] = useState(false);
  const [eSignCenterOpen, setESignCenterOpen] = useState(false);
  const [permissionsOverlayOpen, setPermissionsOverlayOpen] = useState(false);
  const [caseRolesOverlayOpen, setCaseRolesOverlayOpen] = useState(false);
  const [caseEditOpen, setCaseEditOpen] = useState(false);
  const [caseEditForm, setCaseEditForm] = useState(defaultCaseFormState);
  const [caseEditUsers, setCaseEditUsers] = useState([]);
  const [caseEditTypeOptions, setCaseEditTypeOptions] = useState([]);
  const [caseEditTypeAliases, setCaseEditTypeAliases] = useState({});
  const [caseEditSaving, setCaseEditSaving] = useState(false);
  const [caseEditError, setCaseEditError] = useState("");
  const [editingClient, setEditingClient] = useState(false);
  const [deleteCaseDialogOpen, setDeleteCaseDialogOpen] = useState(false);
  const [restoringCase, setRestoringCase] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const [unarchivingCase, setUnarchivingCase] = useState(false);
  const [unarchiveError, setUnarchiveError] = useState("");
  const [notesOverlayOpen, setNotesOverlayOpen] = useState(false);
  const [activitiesOverlayOpen, setActivitiesOverlayOpen] = useState(false);
  const [statementOverlayOpen, setStatementOverlayOpen] = useState(false);
  const [communicationSetup, setCommunicationSetup] = useState(null);
  const [assessmentSaving, setAssessmentSaving] = useState(false);
  const [assessmentError, setAssessmentError] = useState("");
  const [dependantsSaving, setDependantsSaving] = useState(false);
  const [dependantsError, setDependantsError] = useState("");
  const [siblingsSaving, setSiblingsSaving] = useState(false);
  const [siblingsError, setSiblingsError] = useState("");
  const [parentsSaving, setParentsSaving] = useState(false);
  const [parentsError, setParentsError] = useState("");
  const [activityHistorySaving, setActivityHistorySaving] = useState(false);
  const [activityHistoryError, setActivityHistoryError] = useState("");
  const [addressHistorySaving, setAddressHistorySaving] = useState(false);
  const [addressHistoryError, setAddressHistoryError] = useState("");
  const [travelHistorySaving, setTravelHistorySaving] = useState(false);
  const [travelHistoryError, setTravelHistoryError] = useState("");
  const [identityPermitsSaving, setIdentityPermitsSaving] = useState(false);
  const [identityPermitsError, setIdentityPermitsError] = useState("");
  const [reminderSaving, setReminderSaving] = useState(false);
  const [reminderError, setReminderError] = useState("");
  const [questionnaireSaving, setQuestionnaireSaving] = useState(false);
  const [questionnaireError, setQuestionnaireError] = useState("");
  const [caseDocumentsSaving, setCaseDocumentsSaving] = useState(false);
  const [caseDocumentsError, setCaseDocumentsError] = useState("");
  const [profileQuestionnaireSaving, setProfileQuestionnaireSaving] =
    useState(false);
  const [profileQuestionnaireError, setProfileQuestionnaireError] =
    useState("");
  const [applicantProfileSaving, setApplicantProfileSaving] = useState(false);
  const [applicantProfileError, setApplicantProfileError] = useState("");
  const [workHistorySaving, setWorkHistorySaving] = useState(false);
  const [workHistoryError, setWorkHistoryError] = useState("");
  const [educationHistorySaving, setEducationHistorySaving] = useState(false);
  const [educationHistoryError, setEducationHistoryError] = useState("");
  const [languageExamsSaving, setLanguageExamsSaving] = useState(false);
  const [languageExamsError, setLanguageExamsError] = useState("");
  const [spouseDetailsSaving, setSpouseDetailsSaving] = useState(false);
  const [spouseDetailsError, setSpouseDetailsError] = useState("");
  const [workflowOverlayOpen, setWorkflowOverlayOpen] = useState(false);
  const [workflowDraftSteps, setWorkflowDraftSteps] = useState([]);
  const [selectedWorkflowTemplateId, setSelectedWorkflowTemplateId] =
    useState("");
  const [workflowSaving, setWorkflowSaving] = useState(false);
  const [workflowError, setWorkflowError] = useState("");
  const [savingWorkflowStepId, setSavingWorkflowStepId] = useState("");
  const [showWorkflowTemplateForm, setShowWorkflowTemplateForm] =
    useState(false);
  const [creatingWorkflowTemplate, setCreatingWorkflowTemplate] =
    useState(false);
  const [deletingWorkflowTemplateId, setDeletingWorkflowTemplateId] =
    useState("");
  const [workflowTemplateForm, setWorkflowTemplateForm] = useState({
    name: "",
    caseType: "",
  });
  const [workflowTemplateDraftSteps, setWorkflowTemplateDraftSteps] = useState(
    [],
  );

  useEffect(() => {
    const clientName =
      caseItem?.id === id ? String(caseItem.client?.fullName || "").trim() : "";
    document.title = clientName || "CaseDesk";

    return () => {
      document.title = "CaseDesk";
    };
  }, [id, caseItem?.id, caseItem?.client?.fullName]);

  const highlightedNoteId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("overlay") === "notes" ? params.get("note") || "" : "";
  }, [location.search]);

  useEffect(() => {
    if (caseItem?.id !== id) return;
    const params = new URLSearchParams(location.search);
    if (canAccessInternalNotes && params.get("overlay") === "notes") setNotesOverlayOpen(true);
  }, [canAccessInternalNotes, caseItem?.id, id, location.search]);

  const loadCaseProfile = useCallback(async ({ recovery = false } = {}) => {
    const generation = ++loadGenerationRef.current;
    const queueRecovery = (message) => {
      const attempt = recoveryAttemptRef.current;
      const delayMs = CASE_RECOVERY_DELAYS_MS[Math.min(attempt, CASE_RECOVERY_DELAYS_MS.length - 1)];
      recoveryAttemptRef.current += 1;
      setError(`${message} Retrying automatically…`);
      recoveryTimerRef.current = window.setTimeout(() => {
        recoveryTimerRef.current = null;
        void loadCaseProfile({ recovery: true });
      }, delayMs);
    };
    if (recoveryTimerRef.current) {
      window.clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    }
    try {
      if (recovery) setRecovering(true);
      else {
        setLoading(true);
        setCaseItem(null);
        setRestrictedCase(null);
      }

      const get = recovery ? api.getFresh : api.get;
      // The case itself determines whether this route can render, so give it
      // priority instead of making it compete with every supporting panel.
      // Once it succeeds, panel failures can degrade independently.
      const caseResponse = await get(`/cases/${id}`);
      const results = await Promise.allSettled([
        fetchAllCaseDocuments(id, recovery),
        canAccessFinancialData ? get(`/cases/${id}/payment-summary`) : Promise.resolve({ data: { data: null } }),
        get(`/follow-ups?caseId=${id}`),
        canAccessInternalNotes ? get(`/notes?caseId=${id}`) : Promise.resolve({ data: { data: [] } }),
        get(`/activity-logs?caseId=${id}`),
        get(`/cases/${id}/assessment`),
        get(`/cases/${id}/workflow`),
        get("/workflow-templates"),
        canAccessIncentives ? get(`/cases/${id}/timeline-progress`) : Promise.resolve({ data: { data: null } }),
      ]);

      if (!mountedRef.current || generation !== loadGenerationRef.current) return;
      const [
        documentsResult,
        paymentSummaryResult,
        followUpsResult,
        notesResult,
        activityResult,
        assessmentResult,
        workflowResult,
        workflowTemplateResult,
        timelineProgressResult,
      ] = results;

      setCaseItem(caseResponse.data.data || null);
      setRestrictedCase(null);
      setDocuments(
        documentsResult.status === "fulfilled" ? documentsResult.value : [],
      );
      setPaymentSummary(
        paymentSummaryResult.status === "fulfilled"
          ? paymentSummaryResult.value.data.data || { totalFee: 0, paidAmount: 0, balance: 0, status: "Unpaid" }
          : { totalFee: 0, paidAmount: 0, balance: 0, status: "Unpaid" },
      );
      setFollowUps(
        followUpsResult.status === "fulfilled"
          ? followUpsResult.value.data.data || []
          : [],
      );
      setNotes(
        notesResult.status === "fulfilled"
          ? notesResult.value.data.data || []
          : [],
      );
      setActivityLogs(
        activityResult.status === "fulfilled"
          ? activityResult.value.data.data || []
          : [],
      );
      setAssessment(
        assessmentResult.status === "fulfilled"
          ? assessmentResult.value.data.data || null
          : null,
      );
      setWorkflowTemplates(
        workflowTemplateResult.status === "fulfilled"
          ? workflowTemplateResult.value.data.data || []
          : [],
      );

      if (workflowResult.status === "fulfilled") {
        setWorkflowSteps(workflowResult.value.data.data?.steps || []);
        setWorkflowLoadError("");
      } else {
        setWorkflowSteps([]);
        setWorkflowLoadError(
          workflowResult.reason?.response?.data?.message ||
            "Workflow could not load. Refresh after the backend is restarted.",
        );
      }
      // Supplementary panel — unlike workflow, no dedicated error UI; a
      // failed/ungated fetch just means the strip doesn't render.
      setTimelineProgress(
        timelineProgressResult.status === "fulfilled" ? timelineProgressResult.value.data.data : null,
      );

      const recoverablePanelFailure = results.find(
        (result) => result.status === "rejected" && isRecoverableCaseLoadError(result.reason),
      );
      if (recoverablePanelFailure) {
        queueRecovery("Some case details could not load.");
      } else {
        setError("");
        recoveryAttemptRef.current = 0;
      }
    } catch (requestError) {
      if (!mountedRef.current || generation !== loadGenerationRef.current) return;
      if (Number(requestError?.response?.status) === 403 && ["consultant", "frontdesk"].includes(role)) {
        try {
          const previewResponse = await api.getFresh(`/cases/${id}/access-preview`);
          if (!mountedRef.current || generation !== loadGenerationRef.current) return;
          setRestrictedCase(previewResponse.data.data);
          setError("");
          recoveryAttemptRef.current = 0;
          return;
        } catch (previewError) {
          if (!mountedRef.current || generation !== loadGenerationRef.current) return;
          setError(previewError.response?.data?.message || "Unable to load this case.");
          return;
        }
      }
      const message = requestError.response?.data?.message || "Unable to load this case.";
      if (isRecoverableCaseLoadError(requestError)) {
        queueRecovery(message);
      } else {
        setError(message);
      }
    } finally {
      if (mountedRef.current && generation === loadGenerationRef.current) {
        setLoading(false);
        setRecovering(false);
      }
    }
  }, [canAccessFinancialData, canAccessInternalNotes, canAccessIncentives, id, role]);

  const refreshPaymentSummary = useCallback(async () => {
    if (!canAccessFinancialData) return;
    const response = await api.getFresh(`/cases/${id}/payment-summary`);
    setPaymentSummary(
      response.data.data || { totalFee: 0, paidAmount: 0, balance: 0, status: "Unpaid" },
    );
  }, [canAccessFinancialData, id]);

  useEffect(() => {
    mountedRef.current = true;
    recoveryAttemptRef.current = 0;
    void loadCaseProfile();
    return () => {
      mountedRef.current = false;
      if (recoveryTimerRef.current) window.clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    };
  }, [loadCaseProfile]);

  const outstandingDocuments = useMemo(
    () =>
      documents.filter(
        (document) =>
          document.status === "Requested" ||
          document.status === "ChangesRequested",
      ),
    [documents],
  );

  function caseDateInput(value) {
    return value ? new Date(value).toISOString().slice(0, 10) : "";
  }

  async function openCaseEditor() {
    setActiveToolbarTray("");
    setCaseEditError("");
    setCaseEditForm({
      clientId: caseItem.client?.id || caseItem.clientId || "",
      assignedUserId: caseItem.assignedUser?.id || caseItem.assignedUserId || "",
      caseType: caseItem.caseType || "",
      stage: caseItem.stage || "Lead",
      status: caseItem.status || "Open",
      priority: caseItem.priority || "Normal",
      nextAction: caseItem.nextAction || "",
      submittedAt: caseDateInput(caseItem.submittedAt),
      decisionAt: caseDateInput(caseItem.decisionAt),
      studyIntakeMonth: studyIntakeValue(caseItem.studyIntakeMonth),
    });
    setCaseEditUsers(caseItem.assignedUser ? [caseItem.assignedUser] : []);
    setCaseEditTypeOptions(caseItem.caseType ? [caseItem.caseType] : []);
    setCaseEditOpen(true);

    const [staffResult, typesResult] = await Promise.allSettled([
      api.getFresh("/leads/staff"),
      api.getFresh("/cases/case-types"),
    ]);
    if (staffResult.status === "fulfilled") setCaseEditUsers(staffResult.value.data.data || []);
    if (typesResult.status === "fulfilled") {
      setCaseEditTypeOptions(typesResult.value.data.data || []);
      setCaseEditTypeAliases(typesResult.value.data.aliases || {});
    }
  }

  function changeCaseEditField(event) {
    const { name, value } = event.target;
    setCaseEditForm((current) => {
      const next = { ...current, [name]: value };
      if (name === "caseType" && !isStudyPermitCaseType(value)) {
        next.studyIntakeMonth = "";
        if (!caseStagesForType(value).includes(current.stage)) next.stage = "Retainer Pending";
      }
      if (name === "stage" && !current.nextAction) next.nextAction = getDefaultNextAction(value);
      return next;
    });
  }

  async function saveCaseEdit(event) {
    event.preventDefault();
    try {
      setCaseEditSaving(true);
      setCaseEditError("");
      const payload = {
        assignedUserId: caseEditForm.assignedUserId || undefined,
        caseType: caseEditForm.caseType,
        stage: caseEditForm.stage,
        status: caseEditForm.status,
        priority: caseEditForm.priority,
        nextAction: caseEditForm.nextAction.trim() || getDefaultNextAction(caseEditForm.stage),
        submittedAt: caseEditForm.submittedAt || undefined,
        decisionAt: caseEditForm.decisionAt || undefined,
        studyIntakeMonth: isStudyPermitCaseType(caseEditForm.caseType)
          ? studyIntakeApiValue(caseEditForm.studyIntakeMonth)
          : null,
      };
      const response = await api.patch(`/cases/${caseItem.id}`, payload);
      setCaseItem((current) => ({ ...current, ...(response.data.data || response.data) }));
      setCaseEditOpen(false);
    } catch (requestError) {
      setCaseEditError(requestError.response?.data?.message || "Unable to update this case.");
    } finally {
      setCaseEditSaving(false);
    }
  }

  async function contactClient(channel) {
    const needsEmail = channel === "Email";
    const needsPhone = ["Sms", "Call"].includes(channel);
    if ((needsEmail && !caseItem.client?.email) || (needsPhone && !caseItem.client?.phone)) {
      setCommunicationSetup({ channel, reason: "contact", detail: "" });
      return;
    }

    try {
      const response = await api.get("/communications/providers");
      const provider = response.data.data?.[channel] || {};
      const permissions = response.data.meta?.permissions || {};
      const permissionKey = { Email: "canSendEmail", Sms: "canSendSms", Call: "canInitiateCalls", Chat: "canUseChat" }[channel];
      if (permissions[permissionKey] === false) {
        setCommunicationSetup({ channel, reason: "permission", detail: "" });
        return;
      }
      if (channel !== "Chat" && !provider.sendConfigured) {
        setCommunicationSetup({ channel, reason: "provider", detail: provider.detail || "This communication provider is not connected." });
        return;
      }

      const params = new URLSearchParams(location.search);
      params.set("tab", "communication");
      if (channel === "Chat") {
        params.delete("compose");
        params.set("chat", "1");
      } else {
        params.set("compose", channel);
      }
      navigate(`${location.pathname}?${params.toString()}`);
    } catch (requestError) {
      setCommunicationSetup({ channel, reason: "provider", detail: requestError.response?.data?.message || "Communication readiness could not be checked." });
    }
  }

  function closeNotesOverlay() {
    setNotesOverlayOpen(false);
    const params = new URLSearchParams(location.search);
    if (params.get("overlay") !== "notes") return;
    params.delete("overlay");
    params.delete("note");
    navigate(
      `${location.pathname}${params.size ? `?${params.toString()}` : ""}`,
      { replace: true },
    );
  }

  const sortedWorkflowTemplates = useMemo(() => {
    const currentCaseType = caseItem?.caseType || "";

    return [...workflowTemplates].sort((left, right) => {
      const leftMatches = left.caseType === currentCaseType ? 0 : 1;
      const rightMatches = right.caseType === currentCaseType ? 0 : 1;

      if (leftMatches !== rightMatches) {
        return leftMatches - rightMatches;
      }

      return left.name.localeCompare(right.name);
    });
  }, [caseItem?.caseType, workflowTemplates]);

  async function saveAssessment(payload) {
    try {
      setAssessmentSaving(true);
      setAssessmentError("");

      const response = await api.patch(`/cases/${id}/assessment`, payload);
      setAssessment(response.data.data || null);
      setAssessmentOverlayOpen(false);
    } catch (requestError) {
      setAssessmentError(
        requestError.response?.data?.message || "Unable to save assessment.",
      );
    } finally {
      setAssessmentSaving(false);
    }
  }

  async function saveWorkHistory({ entry, entries, meta }) {
    try {
      setWorkHistorySaving(true);
      setWorkHistoryError("");

      const currentFormData = assessment?.formData || {};
      const currentWork = currentFormData.work || {};
      const submittedEntries = Array.isArray(entries)
        ? entries
        : entry
          ? [entry]
          : [];
      const nextEntries =
        meta.hasWorkExperience === "Yes" ? submittedEntries : [];
      const payload = {
        formData: {
          ...currentFormData,
          work: {
            ...currentWork,
            ...meta,
            workHistoryEntries: nextEntries,
          },
        },
        declaredComplete: Boolean(assessment?.declaredComplete),
      };

      const response = await api.patch(`/cases/${id}/assessment`, payload);
      setAssessment(response.data.data || null);
    } catch (requestError) {
      setWorkHistoryError(
        requestError.response?.data?.message || "Unable to save work history.",
      );
      throw requestError;
    } finally {
      setWorkHistorySaving(false);
    }
  }

  async function saveEducationHistory({ entries, yearSummary, meta }) {
    try {
      setEducationHistorySaving(true);
      setEducationHistoryError("");

      const currentFormData = assessment?.formData || {};
      const currentEducation = currentFormData.education || {};
      const submittedEntries = Array.isArray(entries) ? entries : [];
      const nextEntries = meta.hasEducation === "Yes" ? submittedEntries : [];
      const payload = {
        formData: {
          ...currentFormData,
          education: {
            ...currentEducation,
            ...meta,
            educationHistoryEntries: nextEntries,
            yearSummary: meta.hasEducation === "Yes" ? yearSummary || {} : {},
          },
        },
        declaredComplete: Boolean(assessment?.declaredComplete),
      };

      const response = await api.patch(`/cases/${id}/assessment`, payload);
      setAssessment(response.data.data || null);
    } catch (requestError) {
      setEducationHistoryError(
        requestError.response?.data?.message ||
          "Unable to save education history.",
      );
      throw requestError;
    } finally {
      setEducationHistorySaving(false);
    }
  }

  async function saveLanguageExams({ entries, meta }) {
    try {
      setLanguageExamsSaving(true);
      setLanguageExamsError("");

      const currentFormData = assessment?.formData || {};
      const currentLanguage = currentFormData.language || {};
      const currentLanguageExams = currentFormData.languageExams || {};
      const submittedEntries = Array.isArray(entries) ? entries : [];
      const firstLanguageExam = submittedEntries.find(
        (entry) => entry.officialLanguagePriority === "First official language",
      );
      const secondLanguageExam = submittedEntries.find(
        (entry) =>
          entry.officialLanguagePriority === "Second official language",
      );
      const emptyLanguageScores = {
        approvedLanguageTest: submittedEntries.length ? "Yes" : "No",
        firstLanguageTest: "",
        firstLanguageListeningClb: "",
        firstLanguageReadingClb: "",
        firstLanguageWritingClb: "",
        firstLanguageSpeakingClb: "",
        secondLanguageTest: "Not applicable",
        secondLanguageListeningClb: "",
        secondLanguageReadingClb: "",
        secondLanguageWritingClb: "",
        secondLanguageSpeakingClb: "",
      };
      const firstLanguageScores = firstLanguageExam
        ? {
            firstLanguageTest: firstLanguageExam.testType || "",
            firstLanguageListeningClb: firstLanguageExam.listening || "",
            firstLanguageReadingClb: firstLanguageExam.reading || "",
            firstLanguageWritingClb: firstLanguageExam.writing || "",
            firstLanguageSpeakingClb: firstLanguageExam.speaking || "",
          }
        : {};
      const secondLanguageScores = secondLanguageExam
        ? {
            secondLanguageTest: secondLanguageExam.testType || "",
            secondLanguageListeningClb: secondLanguageExam.listening || "",
            secondLanguageReadingClb: secondLanguageExam.reading || "",
            secondLanguageWritingClb: secondLanguageExam.writing || "",
            secondLanguageSpeakingClb: secondLanguageExam.speaking || "",
          }
        : {};
      const payload = {
        formData: {
          ...currentFormData,
          language: {
            ...currentLanguage,
            ...emptyLanguageScores,
            ...firstLanguageScores,
            ...secondLanguageScores,
          },
          languageExams: {
            ...currentLanguageExams,
            ...meta,
            languageExamEntries: submittedEntries,
          },
        },
        declaredComplete: Boolean(assessment?.declaredComplete),
      };

      const response = await api.patch(`/cases/${id}/assessment`, payload);
      setAssessment(response.data.data || null);
    } catch (requestError) {
      setLanguageExamsError(
        requestError.response?.data?.message ||
          "Unable to save language exams.",
      );
      throw requestError;
    } finally {
      setLanguageExamsSaving(false);
    }
  }

  async function saveDependants({ dependants, complete }) {
    try {
      setDependantsSaving(true);
      setDependantsError("");
      const currentFormData = assessment?.formData || {};
      const response = await api.patch(`/cases/${id}/assessment`, {
        formData: {
          ...currentFormData,
          dependantsAndChildren: {
            ...(currentFormData.dependantsAndChildren || {}),
            dependants: Array.isArray(dependants) ? dependants : [],
            hasMoreDependants:
              Array.isArray(dependants) && dependants.length > 1 ? "Yes" : "No",
            complete,
          },
        },
        declaredComplete: Boolean(assessment?.declaredComplete),
      });
      setAssessment(response.data.data || null);
    } catch (requestError) {
      setDependantsError(
        requestError.response?.data?.message ||
          "Unable to save dependant information.",
      );
      throw requestError;
    } finally {
      setDependantsSaving(false);
    }
  }

  async function saveSiblings({ siblings, complete }) {
    try {
      setSiblingsSaving(true);
      setSiblingsError("");
      const currentFormData = assessment?.formData || {};
      const response = await api.patch(`/cases/${id}/assessment`, {
        formData: {
          ...currentFormData,
          siblings: {
            ...(currentFormData.siblings || {}),
            siblings: Array.isArray(siblings) ? siblings : [],
            hasMoreSiblings:
              Array.isArray(siblings) && siblings.length > 1 ? "Yes" : "No",
            complete,
          },
        },
        declaredComplete: Boolean(assessment?.declaredComplete),
      });
      setAssessment(response.data.data || null);
    } catch (requestError) {
      setSiblingsError(
        requestError.response?.data?.message ||
          "Unable to save sibling information.",
      );
      throw requestError;
    } finally {
      setSiblingsSaving(false);
    }
  }

  async function saveParents({ mother, father, complete }) {
    try {
      setParentsSaving(true);
      setParentsError("");
      const currentFormData = assessment?.formData || {};
      const response = await api.patch(`/cases/${id}/assessment`, {
        formData: {
          ...currentFormData,
          parents: {
            ...(currentFormData.parents || {}),
            mother: mother || {},
            father: father || {},
            complete,
          },
        },
        declaredComplete: Boolean(assessment?.declaredComplete),
      });
      setAssessment(response.data.data || null);
    } catch (requestError) {
      setParentsError(
        requestError.response?.data?.message ||
          "Unable to save parent information.",
      );
      throw requestError;
    } finally {
      setParentsSaving(false);
    }
  }

  async function saveActivityHistory({ entries, complete }) {
    try {
      setActivityHistorySaving(true);
      setActivityHistoryError("");
      const currentFormData = assessment?.formData || {};
      const response = await api.patch(`/cases/${id}/assessment`, {
        formData: {
          ...currentFormData,
          activityHistory: {
            ...(currentFormData.activityHistory || {}),
            entries: Array.isArray(entries) ? entries : [],
            complete,
          },
        },
        declaredComplete: Boolean(assessment?.declaredComplete),
      });
      setAssessment(response.data.data || null);
    } catch (requestError) {
      setActivityHistoryError(
        requestError.response?.data?.message ||
          "Unable to save activity history.",
      );
      throw requestError;
    } finally {
      setActivityHistorySaving(false);
    }
  }

  async function saveAddressHistory({ entries, complete }) {
    try {
      setAddressHistorySaving(true);
      setAddressHistoryError("");
      const currentFormData = assessment?.formData || {};
      const response = await api.patch(`/cases/${id}/assessment`, {
        formData: {
          ...currentFormData,
          addressHistory: {
            ...(currentFormData.addressHistory || {}),
            entries: Array.isArray(entries) ? entries : [],
            complete,
          },
        },
        declaredComplete: Boolean(assessment?.declaredComplete),
      });
      setAssessment(response.data.data || null);
    } catch (requestError) {
      setAddressHistoryError(
        requestError.response?.data?.message ||
          "Unable to save address history.",
      );
      throw requestError;
    } finally {
      setAddressHistorySaving(false);
    }
  }

  async function saveTravelHistory({ hasTravelled, entries }) {
    try {
      setTravelHistorySaving(true);
      setTravelHistoryError("");
      const currentFormData = assessment?.formData || {};
      const response = await api.patch(`/cases/${id}/assessment`, {
        formData: {
          ...currentFormData,
          travelHistory: {
            ...(currentFormData.travelHistory || {}),
            hasTravelled,
            entries: Array.isArray(entries) ? entries : [],
          },
        },
        declaredComplete: Boolean(assessment?.declaredComplete),
      });
      setAssessment(response.data.data || null);
    } catch (requestError) {
      setTravelHistoryError(
        requestError.response?.data?.message ||
          "Unable to save travel history.",
      );
      throw requestError;
    } finally {
      setTravelHistorySaving(false);
    }
  }

  async function saveIdentityPermits({ provideDetails, documents, complete }) {
    try {
      setIdentityPermitsSaving(true);
      setIdentityPermitsError("");
      const currentFormData = assessment?.formData || {};
      const response = await api.patch(`/cases/${id}/assessment`, {
        formData: {
          ...currentFormData,
          identityPermits: {
            ...(currentFormData.identityPermits || {}),
            provideDetails,
            documents: Array.isArray(documents) ? documents : [],
            complete,
          },
        },
        declaredComplete: Boolean(assessment?.declaredComplete),
      });
      setAssessment(response.data.data || null);
    } catch (requestError) {
      setIdentityPermitsError(
        requestError.response?.data?.message ||
          "Unable to save identity and permit documents.",
      );
      throw requestError;
    } finally {
      setIdentityPermitsSaving(false);
    }
  }

  async function createReminder(form) {
    try {
      setReminderSaving(true);
      setReminderError("");
      const response = await api.post("/follow-ups", {
        clientId: caseItem.clientId,
        caseId: id,
        title: form.subject,
        description: form.message,
        followUpType: "General follow-up",
        dueDate: new Date(form.dueDate).toISOString(),
        reminderAt: form.reminderAt ? new Date(form.reminderAt).toISOString() : null,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
        notificationChannels: form.notificationChannels,
        notifyClient: form.notifyClient,
        ...(caseItem.archivedAt ? { overrideReason: form.overrideReason } : {}),
        status: "Pending",
      });
      setFollowUps((current) => [response.data.data, ...current]);
    } catch (requestError) {
      setReminderError(
        requestError.response?.data?.message || "Unable to create reminder.",
      );
      throw requestError;
    } finally {
      setReminderSaving(false);
    }
  }

  async function assignQuestionnaire(assignment) {
    try {
      setQuestionnaireSaving(true);
      setQuestionnaireError("");
      const currentFormData = assessment?.formData || {};
      const currentAssignments = Array.isArray(
        currentFormData.questionnaireAssignments,
      )
        ? currentFormData.questionnaireAssignments
        : [];
      const isDuplicate = currentAssignments.some(
        (item) =>
          item.categoryId === assignment.categoryId &&
          item.applicationType === assignment.applicationType,
      );
      const now = new Date().toISOString();
      const nextAssignments = isDuplicate
        ? currentAssignments
        : [
            ...currentAssignments,
            {
              ...assignment,
              id: `${assignment.categoryId}-${Date.now()}`,
              status: "In progress",
              sharing: "Shared",
              assignedAt: now,
              updatedAt: now,
            },
          ];
      const response = await api.patch(`/cases/${id}/assessment`, {
        formData: {
          ...currentFormData,
          questionnaireAssignments: nextAssignments,
        },
        declaredComplete: Boolean(assessment?.declaredComplete),
      });
      setAssessment(response.data.data || null);
    } catch (requestError) {
      setQuestionnaireError(
        requestError.response?.data?.message ||
          "Unable to assign questionnaire.",
      );
      throw requestError;
    } finally {
      setQuestionnaireSaving(false);
    }
  }

  async function updateQuestionnaireAssignment(index, changes, remove = false) {
    try {
      setQuestionnaireSaving(true);
      setQuestionnaireError("");
      const currentFormData = assessment?.formData || {};
      const currentAssignments = Array.isArray(
        currentFormData.questionnaireAssignments,
      )
        ? currentFormData.questionnaireAssignments
        : [];
      const nextAssignments = remove
        ? currentAssignments.filter((_, itemIndex) => itemIndex !== index)
        : currentAssignments.map((item, itemIndex) =>
            itemIndex === index
              ? { ...item, ...changes, updatedAt: new Date().toISOString() }
              : item,
          );
      const response = await api.patch(`/cases/${id}/assessment`, {
        formData: {
          ...currentFormData,
          questionnaireAssignments: nextAssignments,
        },
        declaredComplete: Boolean(assessment?.declaredComplete),
      });
      setAssessment(response.data.data || null);
    } catch (requestError) {
      setQuestionnaireError(
        requestError.response?.data?.message ||
          "Unable to update questionnaire.",
      );
      throw requestError;
    } finally {
      setQuestionnaireSaving(false);
    }
  }

  async function createCaseDocuments(names, metadata = {}) {
    try {
      setCaseDocumentsSaving(true);
      setCaseDocumentsError("");
      const existing = new Set(
        documents
          .filter((item) => item.status !== "NotRequired")
          .map((item) => normalizeDocumentName(item.documentName)),
      );
      const uniqueNamesByKey = new Map();
      names.forEach((name) => {
        const documentName = String(name || "")
          .trim()
          .replace(/\s+/g, " ");
        const key = normalizeDocumentName(documentName);
        if (
          documentName &&
          key &&
          !existing.has(key) &&
          !uniqueNamesByKey.has(key)
        )
          uniqueNamesByKey.set(key, documentName);
      });
      const uniqueNames = [...uniqueNamesByKey.values()];
      if (!uniqueNames.length) return [];
      const response = await api.post(`/cases/${id}/document-checklist`, {
        documents: uniqueNames,
        programId: metadata.programId || null,
        programName: metadata.programName || "Custom checklist",
      });
      const assigned = Array.isArray(response.data.data)
        ? response.data.data
        : [];
      setDocuments((current) => {
        const assignedById = new Map(assigned.map((item) => [item.id, item]));
        const updated = current.map(
          (item) => assignedById.get(item.id) || item,
        );
        const existingIds = new Set(current.map((item) => item.id));
        return [
          ...updated,
          ...assigned.filter((item) => !existingIds.has(item.id)),
        ];
      });
      return assigned;
    } catch (requestError) {
      setCaseDocumentsError(
        requestError.response?.data?.message ||
          "Unable to create document checklist.",
      );
      throw requestError;
    } finally {
      setCaseDocumentsSaving(false);
    }
  }

  async function updateCaseDocumentAssignment(documentIds, status) {
    try {
      setCaseDocumentsError("");
      const ids = Array.isArray(documentIds) ? documentIds : [documentIds];
      const response = await api.patch(`/cases/${id}/document-assignment`, {
        documentIds: ids,
        status,
      });
      const updatedDocuments = Array.isArray(response.data.data)
        ? response.data.data
        : [];
      const updatedById = new Map(
        updatedDocuments.map((item) => [item.id, item]),
      );
      setDocuments((current) =>
        current.map((item) => updatedById.get(item.id) || item),
      );
      return updatedDocuments;
    } catch (requestError) {
      setCaseDocumentsError(
        requestError.response?.data?.message ||
          "Unable to update document assignment.",
      );
      throw requestError;
    }
  }

  async function markCaseDocumentReceived(documentId, file, onProgress) {
    try {
      setCaseDocumentsError("");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("documentId", documentId);
      const response = await api.post("/client-documents/upload", formData, {
        timeout: 60000,
        onUploadProgress: (event) => {
          if (event.total && onProgress)
            onProgress(Math.round((event.loaded / event.total) * 100));
        },
      });
      const updated = response.data.data;
      setDocuments((current) =>
        current.map((item) => (item.id === documentId ? updated : item)),
      );
      return updated;
    } catch (requestError) {
      // The document row owns upload feedback so the message stays beside
      // the Upload button that triggered it.
      throw requestError;
    }
  }

  async function uploadMyCaseDocument(file, onProgress, folderId) {
    try {
      setCaseDocumentsSaving(true);
      setCaseDocumentsError("");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("clientId", caseItem.clientId || caseItem.client?.id);
      formData.append("caseId", id);
      formData.append("documentName", file.name);
      formData.append("visibility", "Internal");
      if (folderId) formData.append("folderId", folderId);
      const response = await api.post("/client-documents/upload", formData, {
        timeout: 60000,
        onUploadProgress: (event) => {
          if (event.total && onProgress)
            onProgress(Math.round((event.loaded / event.total) * 100));
        },
      });
      const created = response.data.data;
      setDocuments((current) => [...current, created]);
      return created;
    } catch (requestError) {
      // The My Documents upload action renders this failure below its button.
      throw requestError;
    } finally {
      setCaseDocumentsSaving(false);
    }
  }

  async function refreshCaseDocuments() {
    try {
      setDocuments(await fetchAllCaseDocuments(id));
      setCaseDocumentsError("");
    } catch (requestError) {
      setCaseDocumentsError(
        requestError.response?.data?.message ||
          "Unable to refresh case documents.",
      );
    }
  }

  async function deleteCaseDocument(documentId) {
    try {
      setCaseDocumentsError("");
      await api.delete(`/client-documents/${documentId}`);
      setDocuments((current) =>
        current.filter((item) => item.id !== documentId),
      );
    } catch (requestError) {
      setCaseDocumentsError(
        requestError.response?.data?.message || "Unable to delete document.",
      );
      throw requestError;
    }
  }

  async function finalizeCaseDocument(documentId) {
    try {
      setCaseDocumentsError("");
      const response = await api.post(
        `/client-documents/${documentId}/finalize`,
      );
      const updated = response.data.data;
      setDocuments((current) =>
        current.map((item) => (item.id === documentId ? updated : item)),
      );
      return updated;
    } catch (requestError) {
      setCaseDocumentsError(
        requestError.response?.data?.message || "Unable to finalize document.",
      );
      throw requestError;
    }
  }

  async function changeCaseDocumentStatus(documentId, status) {
    if (status === "Finalized") return finalizeCaseDocument(documentId);
    try {
      setCaseDocumentsError("");
      const response = await api.post(
        `/client-documents/${documentId}/status`,
        { status },
      );
      const updated = response.data.data;
      setDocuments((current) =>
        current.map((item) => (item.id === documentId ? updated : item)),
      );
      return updated;
    } catch (requestError) {
      setCaseDocumentsError(
        requestError.response?.data?.message ||
          "Unable to update document status.",
      );
      throw requestError;
    }
  }

  async function saveProfileQuestionnaire(sectionId, values) {
    try {
      setProfileQuestionnaireSaving(true);
      setProfileQuestionnaireError("");
      const currentFormData = assessment?.formData || {};
      const currentSections = currentFormData.profileQuestionnaires || {};
      const response = await api.patch(`/cases/${id}/assessment`, {
        formData: {
          ...currentFormData,
          profileQuestionnaires: { ...currentSections, [sectionId]: values },
        },
        declaredComplete: Boolean(assessment?.declaredComplete),
      });
      setAssessment(response.data.data || null);
    } catch (requestError) {
      setProfileQuestionnaireError(
        requestError.response?.data?.message ||
          "Unable to save application profile details.",
      );
      throw requestError;
    } finally {
      setProfileQuestionnaireSaving(false);
    }
  }

  async function saveApplicantProfile(maritalStatus) {
    try {
      setApplicantProfileSaving(true);
      setApplicantProfileError("");
      const currentFormData = assessment?.formData || {};
      const response = await api.patch(`/cases/${id}/assessment`, {
        formData: {
          ...currentFormData,
          profile: { ...currentFormData.profile, maritalStatus },
        },
        declaredComplete: Boolean(assessment?.declaredComplete),
      });
      setAssessment(response.data.data || null);
    } catch (requestError) {
      setApplicantProfileError(
        requestError.response?.data?.message ||
          "Unable to save marital status.",
      );
      throw requestError;
    } finally {
      setApplicantProfileSaving(false);
    }
  }

  async function saveSpouseDetails(section, payload) {
    try {
      setSpouseDetailsSaving(true);
      setSpouseDetailsError("");
      const currentFormData = assessment?.formData || {};
      const currentSpouse = currentFormData.spouse || {};
      let spouseUpdate = {};

      if (section === "work") {
        const entries =
          payload.meta.hasWorkExperience === "Yes" ? payload.entries || [] : [];
        spouseUpdate = { ...payload.meta, workHistoryEntries: entries };
      } else if (section === "education") {
        const entries =
          payload.meta.hasEducation === "Yes" ? payload.entries || [] : [];
        spouseUpdate = {
          ...payload.meta,
          educationHistoryEntries: entries,
          educationYearSummary:
            payload.meta.hasEducation === "Yes"
              ? payload.yearSummary || {}
              : {},
        };
      } else {
        const entries = payload.entries || [];
        const firstExam = entries[0];
        spouseUpdate = {
          ...payload.meta,
          languageExamEntries: entries,
          spouseLanguageTest: firstExam?.testType || "Not applicable",
          spouseLanguageListeningClb: firstExam?.listening || "",
          spouseLanguageReadingClb: firstExam?.reading || "",
          spouseLanguageWritingClb: firstExam?.writing || "",
          spouseLanguageSpeakingClb: firstExam?.speaking || "",
        };
      }

      const response = await api.patch(`/cases/${id}/assessment`, {
        formData: {
          ...currentFormData,
          spouse: { ...currentSpouse, ...spouseUpdate },
        },
        declaredComplete: Boolean(assessment?.declaredComplete),
      });
      setAssessment(response.data.data || null);
    } catch (requestError) {
      setSpouseDetailsError(
        requestError.response?.data?.message ||
          "Unable to save spouse details.",
      );
      throw requestError;
    } finally {
      setSpouseDetailsSaving(false);
    }
  }

  function openWorkflowOverlay() {
    const milestones = workflowSteps.filter((step) => !step.isStandaloneTask);
    setWorkflowDraftSteps(milestones.map(buildDraftStepFromWorkflowStep));
    setSelectedWorkflowTemplateId(
      milestones.find((step) => step.templateId)?.templateId || "",
    );
    setShowWorkflowTemplateForm(false);
    setWorkflowError("");
    setWorkflowOverlayOpen(true);
    setActiveToolbarTray("");
  }

  function openWorkflowTemplateForm() {
    setWorkflowTemplateForm({
      name: `${caseItem?.caseType || "Custom"} workflow`,
      caseType: caseItem?.caseType || "",
    });
    setWorkflowTemplateDraftSteps([buildBlankTemplateStep()]);
    setWorkflowError("");
    setShowWorkflowTemplateForm(true);
  }

  function closeWorkflowTemplateForm() {
    setShowWorkflowTemplateForm(false);
    setWorkflowTemplateDraftSteps([]);
    setWorkflowError("");
  }

  function closeWorkflowOverlay() {
    setWorkflowOverlayOpen(false);
    closeWorkflowTemplateForm();
  }

  function handleWorkflowTemplateFormChange(event) {
    const { name, value } = event.target;

    setWorkflowTemplateForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  async function createWorkflowTemplate(event) {
    event.preventDefault();

    const steps = workflowTemplateDraftSteps.filter((step) =>
      step.title.trim(),
    );

    if (!steps.length) {
      setWorkflowError(
        "Add at least one active milestone before creating a workflow.",
      );
      return;
    }

    try {
      setCreatingWorkflowTemplate(true);
      setWorkflowError("");

      const response = await api.post("/workflow-templates", {
        name: workflowTemplateForm.name,
        caseType: workflowTemplateForm.caseType,
        steps: steps.map((step, index) => ({
          title: step.title,
          description: step.description || null,
          sortOrder: index + 1,
          priority: step.priority || "Normal",
          isRequired: true,
        })),
      });

      const createdTemplate = response.data.data;
      setWorkflowTemplates((current) => [createdTemplate, ...current]);
      setSelectedWorkflowTemplateId(createdTemplate.id);
      setWorkflowDraftSteps(
        (createdTemplate.steps || []).map(buildDraftStepFromTemplateStep),
      );
      setShowWorkflowTemplateForm(false);
      setWorkflowTemplateDraftSteps([]);
    } catch (requestError) {
      setWorkflowError(
        requestError.response?.data?.message ||
          "Unable to create workflow template.",
      );
    } finally {
      setCreatingWorkflowTemplate(false);
    }
  }

  function updateWorkflowTemplateDraftStep(index, updates) {
    setWorkflowTemplateDraftSteps((current) =>
      current.map((step, stepIndex) =>
        stepIndex === index ? { ...step, ...updates } : step,
      ),
    );
  }

  function moveWorkflowTemplateDraftStep(index, direction) {
    setWorkflowTemplateDraftSteps((current) => {
      const targetIndex = index + direction;

      if (targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }

      const next = [...current];
      const [step] = next.splice(index, 1);
      next.splice(targetIndex, 0, step);

      return next.map((item, itemIndex) => ({
        ...item,
        sortOrder: itemIndex + 1,
      }));
    });
  }

  function addWorkflowTemplateDraftStep() {
    setWorkflowTemplateDraftSteps((current) => [
      ...current,
      buildBlankTemplateStep(current.length),
    ]);
  }

  function removeWorkflowTemplateDraftStep(index) {
    setWorkflowTemplateDraftSteps((current) =>
      current
        .filter((_, stepIndex) => stepIndex !== index)
        .map((step, stepIndex) => ({
          ...step,
          sortOrder: stepIndex + 1,
        })),
    );
  }

  async function deleteWorkflowTemplate(template) {
    if (template.isDefault) {
      return;
    }

    const confirmed = window.confirm(
      `Delete "${template.name}" workflow template?`,
    );

    if (!confirmed) {
      return;
    }

    try {
      setDeletingWorkflowTemplateId(template.id);
      setWorkflowError("");
      await api.delete(`/workflow-templates/${template.id}`);
      setWorkflowTemplates((current) =>
        current.filter((item) => item.id !== template.id),
      );

      if (selectedWorkflowTemplateId === template.id) {
        setSelectedWorkflowTemplateId("");
      }
    } catch (requestError) {
      setWorkflowError(
        requestError.response?.data?.message ||
          "Unable to delete workflow template.",
      );
    } finally {
      setDeletingWorkflowTemplateId("");
    }
  }

  function handleSelectWorkflowTemplate(template) {
    setSelectedWorkflowTemplateId(template.id);
    setWorkflowDraftSteps(
      (template.steps || []).map(buildDraftStepFromTemplateStep),
    );
    setWorkflowError("");
  }

  function updateWorkflowDraftStep(index, updates) {
    setWorkflowDraftSteps((current) =>
      current.map((step, stepIndex) =>
        stepIndex === index ? { ...step, ...updates } : step,
      ),
    );
  }

  function toggleWorkflowDraftStep(index) {
    setWorkflowDraftSteps((current) =>
      current.map((step, stepIndex) =>
        stepIndex === index
          ? { ...step, isActive: step.isActive === false }
          : step,
      ),
    );
  }

  function moveWorkflowDraftStep(index, direction) {
    setWorkflowDraftSteps((current) => {
      const targetIndex = index + direction;

      if (targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }

      const next = [...current];
      const [step] = next.splice(index, 1);
      next.splice(targetIndex, 0, step);

      return next.map((item, itemIndex) => ({
        ...item,
        sortOrder: itemIndex + 1,
      }));
    });
  }

  function addWorkflowDraftStep() {
    setWorkflowDraftSteps((current) => [
      ...current,
      {
        localId: `custom-${Date.now()}`,
        templateStepId: "",
        title: "New milestone",
        description: "",
        sortOrder: current.length + 1,
        priority: "Normal",
        isActive: true,
        status: "Pending",
        completedAt: null,
      },
    ]);
  }

  function removeWorkflowDraftStep(index) {
    setWorkflowDraftSteps((current) =>
      current
        .filter((_, stepIndex) => stepIndex !== index)
        .map((step, stepIndex) => ({
          ...step,
          sortOrder: stepIndex + 1,
        })),
    );
  }

  async function saveWorkflowDraft() {
    try {
      setWorkflowSaving(true);
      setWorkflowError("");

      const response = await api.patch(`/cases/${id}/workflow`, {
        templateId: selectedWorkflowTemplateId || null,
        steps: workflowDraftSteps.map((step, index) => ({
          templateStepId: step.templateStepId || null,
          title: step.title,
          description: step.description || null,
          sortOrder: index + 1,
          priority: step.priority || "Normal",
          isActive: step.isActive !== false,
          status: step.status || "Pending",
          completedAt: step.completedAt || null,
        })),
      });

      setWorkflowSteps(response.data.data || []);
      setWorkflowOverlayOpen(false);
    } catch (requestError) {
      setWorkflowError(
        requestError.response?.data?.message || "Unable to save workflow.",
      );
    } finally {
      setWorkflowSaving(false);
    }
  }

  async function toggleWorkflowStepStatus(step) {
    const nextStatus = step.status === "Completed" ? "Pending" : "Completed";

    try {
      setSavingWorkflowStepId(step.id);
      setWorkflowSteps((current) =>
        current.map((item) =>
          item.id === step.id
            ? {
                ...item,
                status: nextStatus,
                completedAt:
                  nextStatus === "Completed"
                    ? item.completedAt || new Date().toISOString()
                    : null,
              }
            : item,
        ),
      );

      const response = await api.patch(`/cases/${id}/workflow/${step.id}`, {
        status: nextStatus,
      });

      setWorkflowSteps((current) =>
        current.map((item) =>
          item.id === step.id ? response.data.data : item,
        ),
      );
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Unable to update workflow step.",
      );
      setWorkflowSteps((current) =>
        current.map((item) => (item.id === step.id ? step : item)),
      );
    } finally {
      setSavingWorkflowStepId("");
    }
  }

  async function createCaseTask(values) {
    const response = await api.post(`/cases/${id}/tasks`, values);
    const created = response.data.data;
    setWorkflowSteps((current) =>
      [...current, created].sort(
        (left, right) => (left.sortOrder || 0) - (right.sortOrder || 0),
      ),
    );
    return created;
  }

  async function updateCaseTask(task, values) {
    const response = await api.patch(
      `/cases/${id}/workflow/${task.id}`,
      values,
    );
    const updated = response.data.data;
    setWorkflowSteps((current) =>
      current.map((item) => (item.id === task.id ? updated : item)),
    );
    return updated;
  }

  async function deleteCaseTask(task) {
    const response = await api.patch(`/cases/${id}/tasks/${task.id}/cancel`);
    const cancelled = response.data.data;
    setWorkflowSteps((current) =>
      current.map((item) => (item.id === task.id ? cancelled : item)),
    );
  }

  if (loading) {
    return (
      <PageContainer title="Case file" description="Loading case details...">
        <div className="space-y-6">
          <div className="h-28 animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-56 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      </PageContainer>
    );
  }

  if (restrictedCase) {
    return (
      <PageContainer title="Case access" description="A protected CaseDesk workspace.">
        <RestrictedCaseAccess preview={restrictedCase} onChange={setRestrictedCase} />
      </PageContainer>
    );
  }

  if (!caseItem) {
    return (
      <PageContainer
        title="Case file"
        description="Unable to load this case route."
      >
        <div className="flex flex-col gap-4 rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>{error || "Try opening a case from the cases list."}</span>
          <button
            type="button"
            onClick={() => {
              recoveryAttemptRef.current = 0;
              void loadCaseProfile({ recovery: true });
            }}
            disabled={recovering}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${recovering ? "animate-spin" : ""}`} />
            Retry now
          </button>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title="Case file"
      description="Manage this case, communication, and access from one place."
      actions={
        caseItem.client?.id ? (
          <Link
            to={`/clients/${caseItem.client.id}`}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
          >
            Client profile
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        ) : null
      }
    >
      {error ? (
        <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {workflowOverlayOpen ? (
        <WorkflowOverlay
          caseType={caseItem.caseType}
          templates={sortedWorkflowTemplates}
          selectedTemplateId={selectedWorkflowTemplateId}
          draftSteps={workflowDraftSteps}
          creatingTemplate={creatingWorkflowTemplate}
          deletingTemplateId={deletingWorkflowTemplateId}
          onSelectTemplate={handleSelectWorkflowTemplate}
          onOpenTemplateForm={openWorkflowTemplateForm}
          onDeleteTemplate={deleteWorkflowTemplate}
          onUpdateStep={updateWorkflowDraftStep}
          onToggleStep={toggleWorkflowDraftStep}
          onMoveStep={moveWorkflowDraftStep}
          onAddStep={addWorkflowDraftStep}
          onRemoveStep={removeWorkflowDraftStep}
          onClose={closeWorkflowOverlay}
          onSave={saveWorkflowDraft}
          saving={workflowSaving}
          error={workflowError}
        />
      ) : null}

      {workflowOverlayOpen && showWorkflowTemplateForm ? (
        <WorkflowTemplateCreateOverlay
          caseType={caseItem.caseType}
          templateForm={workflowTemplateForm}
          templateDraftSteps={workflowTemplateDraftSteps}
          creatingTemplate={creatingWorkflowTemplate}
          error={workflowError}
          onTemplateFormChange={handleWorkflowTemplateFormChange}
          onUpdateTemplateDraftStep={updateWorkflowTemplateDraftStep}
          onMoveTemplateDraftStep={moveWorkflowTemplateDraftStep}
          onAddTemplateDraftStep={addWorkflowTemplateDraftStep}
          onRemoveTemplateDraftStep={removeWorkflowTemplateDraftStep}
          onCreateTemplate={createWorkflowTemplate}
          onClose={closeWorkflowTemplateForm}
        />
      ) : null}

      {assessmentOverlayOpen ? (
        <AssessmentOverlay
          caseItem={caseItem}
          assessment={assessment}
          saving={assessmentSaving}
          error={assessmentError}
          onClose={() => {
            setAssessmentOverlayOpen(false);
            setAssessmentError("");
          }}
          onSave={saveAssessment}
        />
      ) : null}

      {applicantsOverlayOpen ? (
        <ApplicantsOverlay
          caseItem={caseItem}
          onClose={() => setApplicantsOverlayOpen(false)}
        />
      ) : null}

      {notesOverlayOpen ? (
        <NotesOverlay
          caseItem={caseItem}
          initialNotes={notes}
          highlightNoteId={highlightedNoteId}
          onNotesChange={setNotes}
          onClose={closeNotesOverlay}
        />
      ) : null}

      {activitiesOverlayOpen ? (
        <ActivitiesOverlay
          caseItem={caseItem}
          initialActivities={activityLogs}
          onClose={() => setActivitiesOverlayOpen(false)}
        />
      ) : null}

      {statementOverlayOpen && caseItem.client?.id ? (
        <StatementOfAccountOverlay
          clientId={caseItem.client.id}
          initialCaseId={caseItem.id}
          onClose={() => setStatementOverlayOpen(false)}
        />
      ) : null}

      {communicationSetup ? (
        <CommunicationSetupOverlay
          {...communicationSetup}
          caseItem={caseItem}
          role={role}
          onClose={() => setCommunicationSetup(null)}
        />
      ) : null}

      {eSignCenterOpen ? (
        <ESignCenterOverlay caseItem={caseItem} onClose={() => setESignCenterOpen(false)} />
      ) : null}

      {permissionsOverlayOpen && role === "admin" ? (
        <CasePermissionsOverlay
          caseItem={caseItem}
          onClose={() => setPermissionsOverlayOpen(false)}
          onSaved={(permissions) => setCaseItem((current) => ({ ...current, assignedUser: permissions.owner, assignedUserId: permissions.owner?.id || null }))}
        />
      ) : null}

      {caseRolesOverlayOpen ? (
        <CaseRolesOverlay
          caseItem={caseItem}
          onClose={() => setCaseRolesOverlayOpen(false)}
          onSaved={(collaboration) => setCaseItem((current) => ({
            ...current,
            // RCIC is the primary owner; keep the case summary header's
            // RCIC/Case Worker badges live without a full reload.
            assignedUser: collaboration.owner,
            assignedUserId: collaboration.owner?.id || null,
            roleAssignments: [
              collaboration.requiredTeam?.rcic
                ? { caseRole: { code: "rcic", name: collaboration.requiredTeam.roles?.rcic?.name || "RCIC" }, user: collaboration.requiredTeam.rcic }
                : null,
              collaboration.requiredTeam?.caseWorker
                ? { caseRole: { code: "case-worker", name: collaboration.requiredTeam.roles?.caseWorker?.name || "Case Worker" }, user: collaboration.requiredTeam.caseWorker }
                : null,
            ].filter(Boolean),
          }))}
        />
      ) : null}

      {editingClient ? (
        <ClientEditDrawer
          client={caseItem.client}
          onClose={() => setEditingClient(false)}
          onSaved={(updatedClient) => {
            setCaseItem((current) => ({ ...current, client: { ...current.client, ...updatedClient } }));
            setEditingClient(false);
          }}
        />
      ) : null}

      <section className="space-y-8">
        {caseItem?.deletedAt ? (
          <article className="flex flex-wrap items-center justify-between gap-3 rounded-[1.9rem] border border-rose-200/80 bg-rose-50/90 px-5 py-4 shadow-[0_18px_55px_rgba(190,18,60,0.08)]">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 text-rose-600">
                <Trash2 className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-rose-900">This case is in the trash</p>
                <p className="text-sm text-rose-700/80">
                  It is hidden from lists and the client portal.{restoreError ? ` ${restoreError}` : ""}
                </p>
              </div>
            </div>
            {canManageCase ? (
              <button
                type="button"
                disabled={restoringCase}
                onClick={async () => {
                  setRestoringCase(true);
                  setRestoreError("");
                  try {
                    const response = await api.patch(`/cases/${caseItem.id}/restore`);
                    setCaseItem((current) => ({ ...current, ...response.data.data }));
                  } catch (requestError) {
                    setRestoreError(requestError.response?.data?.message || "Unable to restore this case.");
                  } finally {
                    setRestoringCase(false);
                  }
                }}
                className="inline-flex items-center gap-2 rounded-full bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:opacity-60"
              >
                {restoringCase ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                ) : null}
                {restoringCase ? "Restoring…" : "Restore case"}
              </button>
            ) : null}
          </article>
        ) : caseItem?.archivedAt ? (
          <article className="flex flex-wrap items-center justify-between gap-3 rounded-[1.9rem] border border-violet-200/80 bg-violet-50/90 px-5 py-4 shadow-[0_18px_55px_rgba(109,40,217,0.08)]">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100 text-violet-600">
                <Archive className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-violet-950">This case is archived</p>
                <p className="text-sm text-violet-700/80">
                  Its complete history is retained outside the active register.{unarchiveError ? ` ${unarchiveError}` : ""}
                </p>
              </div>
            </div>
            {canManageCase ? (
              <button
                type="button"
                disabled={unarchivingCase}
                onClick={async () => {
                  setUnarchivingCase(true);
                  setUnarchiveError("");
                  try {
                    const response = await api.patch(`/cases/${caseItem.id}/unarchive`);
                    setCaseItem((current) => ({ ...current, ...response.data.data }));
                  } catch (requestError) {
                    setUnarchiveError(requestError.response?.data?.message || "Unable to restore this case from archive.");
                  } finally {
                    setUnarchivingCase(false);
                  }
                }}
                className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-60"
              >
                {unarchivingCase ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                ) : (
                  <ArchiveRestore className="h-4 w-4" />
                )}
                {unarchivingCase ? "Restoring…" : "Restore from archive"}
              </button>
            ) : null}
          </article>
        ) : null}
        <CaseProfileTopSection
          caseItem={caseItem}
          paymentSummary={paymentSummary}
          showFinancials={canAccessFinancialData}
          showPortalAccess={canManageClientPortal}
          showCommunications={canAccessCaseCommunication}
          showEditCase={canManageCase && !caseItem.deletedAt}
          showEditClient={canManageCase}
          outstandingDocuments={outstandingDocuments}
          onContactClient={contactClient}
          onEditCase={openCaseEditor}
          onEditClient={() => setEditingClient(true)}
          canManageCollaborators={canManageCase}
          onManageCollaborators={() => setCaseRolesOverlayOpen(true)}
        />

        <CaseProfileToolbar
          activeToolbarTray={activeToolbarTray}
          setActiveToolbarTray={setActiveToolbarTray}
          canManagePermissions={role === "admin" && !caseItem.deletedAt}
          canManageCase={canManageCase}
          canDownloadApplication={canAccessCaseForms || canAccessCaseDocuments}
          onOpenWorkflow={openWorkflowOverlay}
          onDownloadApplication={() => {
            setActiveToolbarTray("");
            setDownloadApplicationOverlayOpen(true);
          }}
          onOpenApplicants={() => {
            setActiveToolbarTray("");
            setApplicantsOverlayOpen(true);
          }}
          onOpenCaseRoles={() => {
            setActiveToolbarTray("");
            setCaseRolesOverlayOpen(true);
          }}
          onOpenPermissions={() => {
            setActiveToolbarTray("");
            setPermissionsOverlayOpen(true);
          }}
          onOpenNotes={!canAccessInternalNotes ? null : () => {
            setActiveToolbarTray("");
            setNotesOverlayOpen(true);
          }}
          onOpenActivities={() => {
            setActiveToolbarTray("");
            setActivitiesOverlayOpen(true);
          }}
          onOpenStatement={!canAccessFinancialData ? null : () => {
            setActiveToolbarTray("");
            setStatementOverlayOpen(true);
          }}
          onOpenESign={() => {
            setActiveToolbarTray("");
            setESignCenterOpen(true);
          }}
          onArchiveCase={() => {
            setActiveToolbarTray("");
            setArchiveCaseDialogOpen(true);
          }}
          onCloseCase={() => {
            setActiveToolbarTray("");
            setCloseBillingDisposition("keep_outstanding");
            setCloseBillingReason("");
            setCloseCaseDialogOpen(true);
          }}
          onDeleteCase={() => {
            setActiveToolbarTray("");
            setDeleteCaseDialogOpen(true);
          }}
        />

        {caseEditOpen ? (
          <CaseFormDrawer
            formState={caseEditForm}
            onChange={changeCaseEditField}
            onSubmit={saveCaseEdit}
            onCancel={() => setCaseEditOpen(false)}
            saving={caseEditSaving}
            formError={caseEditError}
            clients={[]}
            users={caseEditUsers}
            caseTypeOptions={caseEditTypeOptions}
            caseTypeAliases={caseEditTypeAliases}
            isEditing
            editingClientName={caseItem.client?.fullName || "Unknown client"}
            closing={false}
          />
        ) : null}

        {downloadApplicationOverlayOpen ? (
          <DownloadApplicationOverlay
            caseItem={caseItem}
            documents={documents}
            canAccessForms={canAccessCaseForms}
            canAccessDocuments={canAccessCaseDocuments}
            onClose={() => setDownloadApplicationOverlayOpen(false)}
          />
        ) : null}

        <CaseActionDialog
          open={archiveCaseDialogOpen}
          onClose={() => setArchiveCaseDialogOpen(false)}
          icon={Archive}
          iconWrapClassName="bg-violet-50 text-violet-600"
          title="Archive this case?"
          message="It will leave the normal and closed registers while its documents, payments, communications, and activity history remain available."
          confirmLabel="Archive case"
          workingLabel="Archiving…"
          confirmClassName="bg-violet-600 hover:bg-violet-500"
          successTitle="Case archived"
          successMessage="You can restore it from the Archived register."
          blocked={
            caseItem?.archivedAt
              ? { title: "Already archived", message: "Restore this case from archive before archiving it again." }
              : !TERMINAL_CASE_STATUSES.has(caseItem?.status)
                ? { title: "Close this case first", message: "Archiving stores completed case history. Close the active case before moving it to the archive." }
                : null
          }
          action={async () => (await api.patch(`/cases/${caseItem.id}/archive`)).data.data}
          onSuccess={(archivedCase) => setCaseItem((current) => ({ ...current, ...archivedCase }))}
        />

        <CaseActionDialog
          open={closeCaseDialogOpen}
          onClose={() => setCloseCaseDialogOpen(false)}
          icon={FolderCheck}
          iconWrapClassName="bg-amber-50 text-amber-600"
          title="Close this case?"
          message={Number(paymentSummary.balance) > 0
            ? `This case has ${Number(paymentSummary.balance).toLocaleString("en-CA", { style: "currency", currency: "CAD" })} outstanding. Choose how to handle it below — closing will also cancel pending tasks, follow-ups, and appointments.`
            : "Pending tasks, follow-ups, and appointments will be cancelled. Documents, payments, and history stay on record."}
          extra={Number(paymentSummary.balance) > 0 ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm leading-5 text-slate-700 has-[:checked]:border-amber-300 has-[:checked]:bg-amber-50">
                  <input
                    type="radio"
                    name="close-billing-disposition"
                    value="keep_outstanding"
                    checked={closeBillingDisposition === "keep_outstanding"}
                    onChange={() => setCloseBillingDisposition("keep_outstanding")}
                    className="mt-0.5 h-4 w-4 accent-amber-600"
                  />
                  <span><span className="font-semibold">Keep collectible</span> — stays owed after closing.</span>
                </label>
                {role === "admin" ? (
                  <label className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm leading-5 text-slate-700 has-[:checked]:border-rose-300 has-[:checked]:bg-rose-50">
                    <input
                      type="radio"
                      name="close-billing-disposition"
                      value="write_off"
                      checked={closeBillingDisposition === "write_off"}
                      onChange={() => setCloseBillingDisposition("write_off")}
                      className="mt-0.5 h-4 w-4 accent-rose-600"
                    />
                    <span><span className="font-semibold">Write off</span> — this balance will also be closed. Nothing further will be collected.</span>
                  </label>
                ) : null}
              </div>
              <label className="block text-xs font-semibold text-slate-600">
                Reason
                <textarea
                  required
                  rows={2}
                  maxLength={500}
                  value={closeBillingReason}
                  onChange={(event) => setCloseBillingReason(event.target.value)}
                  placeholder="Why is this balance being handled this way?"
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400"
                />
              </label>
            </div>
          ) : null}
          confirmDisabled={Number(paymentSummary.balance) > 0 && !closeBillingReason.trim()}
          confirmLabel="Close case"
          workingLabel="Closing…"
          successTitle="Case closed"
          successMessage={Number(paymentSummary.balance) > 0
            ? closeBillingDisposition === "write_off"
              ? "The outstanding balance was written off."
              : "The outstanding balance stays collectible."
            : "Everything stays on record."}
          blocked={
            TERMINAL_CASE_STATUSES.has(caseItem?.status)
              ? {
                  title: "Already closed",
                  message: `This case is ${caseItem?.status?.toLowerCase() || "closed"}, so there is nothing left to close.`,
                }
              : null
          }
          action={async () => (await api.patch(`/cases/${caseItem.id}/close`, Number(paymentSummary.balance) > 0 ? { billingDisposition: closeBillingDisposition, billingReason: closeBillingReason.trim() } : {})).data.data}
          onSuccess={(closedCase) => {
            setCaseItem((current) => ({ ...current, ...closedCase }));
            setFollowUps((current) =>
              current.map((followUp) =>
                ["Pending", "Overdue"].includes(followUp.status) ? { ...followUp, status: "Cancelled" } : followUp,
              ),
            );
            setWorkflowSteps((current) =>
              current.map((step) => (step.status === "Pending" ? { ...step, status: "Cancelled", isActive: false } : step)),
            );
          }}
        />

        <CaseActionDialog
          open={deleteCaseDialogOpen}
          onClose={() => setDeleteCaseDialogOpen(false)}
          icon={Trash2}
          iconWrapClassName="bg-rose-50 text-rose-600"
          title="Move this case to Trash?"
          message="It will disappear from case lists, dashboards, and the client portal. Nothing is destroyed — you can restore it anytime."
          confirmLabel="Move to Trash"
          workingLabel="Moving…"
          confirmClassName="bg-rose-600 hover:bg-rose-500"
          successTitle="Moved to Trash"
          successMessage="Restore it anytime from the Cases page."
          blocked={
            caseItem?.deletedAt
              ? { title: "Already in Trash", message: "This case is already in the trash. You can restore it from the banner above." }
              : null
          }
          action={async () => (await api.delete(`/cases/${caseItem.id}`)).data.data}
          onSuccess={() => navigate("/app/cases")}
        />

        <WorkflowTimeline
          steps={workflowSteps.filter((step) => !step.isStandaloneTask)}
          loadError={workflowLoadError}
          onToggleStep={toggleWorkflowStepStatus}
          savingStepId={savingWorkflowStepId}
          onOpen={openWorkflowOverlay}
        />

        {canAccessIncentives && timelineProgress?.legs?.length ? (
          <article className="rounded-[1.9rem] border border-white/80 bg-white/88 px-5 py-4 shadow-[0_18px_55px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Incentives</p>
              <h3 className="mt-1 text-base font-semibold text-slate-950">{timelineProgress.planName} — timeline bonuses</h3>
            </div>
            <div className="mt-5">
              <TimelineProgressStrip legs={timelineProgress.legs} now={timelineNow} />
            </div>
          </article>
        ) : null}

        <CaseWorkspaceTabs
          caseItem={caseItem}
          documents={documents}
          followUps={followUps}
          notes={notes}
          activityLogs={activityLogs}
          workflowSteps={workflowSteps}
          paymentSummary={paymentSummary}
          onBillingChanged={refreshPaymentSummary}
          outstandingDocuments={outstandingDocuments}
          assessment={assessment}
          onConductAssessment={() => {
            setAssessmentError("");
            setAssessmentOverlayOpen(true);
          }}
          onSaveWorkHistory={saveWorkHistory}
          savingWorkHistory={workHistorySaving}
          workHistoryError={workHistoryError}
          onSaveEducationHistory={saveEducationHistory}
          savingEducationHistory={educationHistorySaving}
          educationHistoryError={educationHistoryError}
          onSaveLanguageExams={saveLanguageExams}
          savingLanguageExams={languageExamsSaving}
          languageExamsError={languageExamsError}
          onSaveDependants={saveDependants}
          savingDependants={dependantsSaving}
          dependantsError={dependantsError}
          onSaveSiblings={saveSiblings}
          savingSiblings={siblingsSaving}
          siblingsError={siblingsError}
          onSaveParents={saveParents}
          savingParents={parentsSaving}
          parentsError={parentsError}
          onSaveActivityHistory={saveActivityHistory}
          savingActivityHistory={activityHistorySaving}
          activityHistoryError={activityHistoryError}
          onSaveAddressHistory={saveAddressHistory}
          savingAddressHistory={addressHistorySaving}
          addressHistoryError={addressHistoryError}
          onSaveTravelHistory={saveTravelHistory}
          savingTravelHistory={travelHistorySaving}
          travelHistoryError={travelHistoryError}
          onSaveIdentityPermits={saveIdentityPermits}
          savingIdentityPermits={identityPermitsSaving}
          identityPermitsError={identityPermitsError}
          onCreateReminder={createReminder}
          savingReminder={reminderSaving}
          reminderError={reminderError}
          onAssignQuestionnaire={assignQuestionnaire}
          onUpdateQuestionnaire={updateQuestionnaireAssignment}
          savingQuestionnaire={questionnaireSaving}
          questionnaireError={questionnaireError}
          onCreateCaseDocuments={createCaseDocuments}
          onMarkCaseDocumentReceived={markCaseDocumentReceived}
          onUpdateCaseDocumentAssignment={updateCaseDocumentAssignment}
          onUploadMyCaseDocument={uploadMyCaseDocument}
          onRefreshCaseDocuments={refreshCaseDocuments}
          onDeleteCaseDocument={deleteCaseDocument}
          onFinalizeCaseDocument={finalizeCaseDocument}
          onChangeCaseDocumentStatus={changeCaseDocumentStatus}
          savingCaseDocuments={caseDocumentsSaving}
          caseDocumentsError={caseDocumentsError}
          onCreateTask={createCaseTask}
          onUpdateTask={updateCaseTask}
          onDeleteTask={deleteCaseTask}
          onSaveProfileQuestionnaire={saveProfileQuestionnaire}
          savingProfileQuestionnaire={profileQuestionnaireSaving}
          profileQuestionnaireError={profileQuestionnaireError}
          onSaveApplicantProfile={saveApplicantProfile}
          savingApplicantProfile={applicantProfileSaving}
          applicantProfileError={applicantProfileError}
          onEditClient={() => setEditingClient(true)}
          onSaveSpouseDetails={saveSpouseDetails}
          savingSpouseDetails={spouseDetailsSaving}
          spouseDetailsError={spouseDetailsError}
        />
      </section>
    </PageContainer>
  );
}
