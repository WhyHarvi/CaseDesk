import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import api from "../../services/api";
import {
  ClientDrawer,
  dateOfBirthError,
  defaultClientFormState,
  newClientOperationKey,
} from "../../pages/Clients";
import {
  CaseFormDrawer,
  defaultCaseFormState,
  getDefaultNextAction,
  newCaseOperationKey,
} from "../../pages/Cases";
import { caseStagesForType } from "../../constants/caseStages";
import { isStudyPermitCaseType, studyIntakeApiValue } from "../../utils/studyIntake";

export default function QuickCreateCurtains({ kind, onClose }) {
  const navigate = useNavigate();
  const { role } = useAuth();
  const [closing, setClosing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [dobError, setDobError] = useState("");
  const [clientForm, setClientForm] = useState(defaultClientFormState);
  const [caseForm, setCaseForm] = useState(defaultCaseFormState);
  const [clientKey, setClientKey] = useState(newClientOperationKey);
  const [caseKey, setCaseKey] = useState(newCaseOperationKey);
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [caseTypeOptions, setCaseTypeOptions] = useState([]);
  const [contactMatches, setContactMatches] = useState([]);
  const [checkingContact, setCheckingContact] = useState(false);

  useEffect(() => {
    if (!kind) return;
    setClosing(false);
    setSaving(false);
    setFormError("");
    setDobError("");
    if (kind === "client") {
      setClientForm(defaultClientFormState);
      setClientKey(newClientOperationKey());
    } else {
      setCaseForm(defaultCaseFormState);
      setCaseKey(newCaseOperationKey());
    }

    Promise.allSettled([
      api.get("/clients"),
      api.get("/leads/staff"),
      api.get("/cases/case-types"),
    ]).then(([clientResult, userResult, typeResult]) => {
      if (clientResult.status === "fulfilled") setClients(clientResult.value.data.data || []);
      if (userResult.status === "fulfilled") setUsers(userResult.value.data.data || []);
      if (typeResult.status === "fulfilled") setCaseTypeOptions(typeResult.value.data.data || []);
    });
  }, [kind]);

  useEffect(() => {
    if (!kind) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [kind]);

  useEffect(() => {
    if (kind !== "client") return undefined;
    const email = clientForm.email.trim();
    const phone = clientForm.phone.trim();
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const validPhone = phone.replace(/\D/g, "").length >= 7;
    if (!validEmail && !validPhone) {
      setContactMatches([]);
      setCheckingContact(false);
      return undefined;
    }
    let active = true;
    setCheckingContact(true);
    const timer = window.setTimeout(() => {
      api.get("/clients/contact-matches", { params: { ...(validEmail ? { email } : {}), ...(validPhone ? { phone } : {}) } })
        .then((response) => { if (active) setContactMatches(response.data.data || []); })
        .catch(() => { if (active) setContactMatches([]); })
        .finally(() => { if (active) setCheckingContact(false); });
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [clientForm.email, clientForm.phone, kind]);

  function close() {
    setClosing(true);
    window.setTimeout(onClose, 260);
  }

  function handleClientChange(event) {
    const { name, value } = event.target;
    setClientForm((current) => ({ ...current, [name]: value }));
    if (name === "dateOfBirth" && dobError) setDobError(dateOfBirthError(value));
  }

  async function submitClient(event) {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      if (!clientForm.givenNames.trim() && !clientForm.familyName.trim()) throw new Error("Enter at least a given name or family name.");
      const nextDobError = dateOfBirthError(clientForm.dateOfBirth);
      if (nextDobError) {
        setDobError(nextDobError);
        throw new Error("Correct the highlighted date of birth before saving.");
      }
      const payload = { ...clientForm, givenNames: clientForm.givenNames.trim(), familyName: clientForm.familyName.trim(), email: clientForm.email.trim(), phone: clientForm.phone.trim(), address: clientForm.address.trim(), assignedUserId: clientForm.assignedUserId || "", idempotencyKey: clientKey };
      ["email", "phone", "address", "dateOfBirth", "identificationExpiryDate"].forEach((field) => { if (!payload[field]) delete payload[field]; });
      const response = await api.post("/clients", payload);
      onClose();
      navigate(`/app/clients/${encodeURIComponent(response.data.data.id)}`);
    } catch (error) {
      setFormError(error.response?.data?.message || error.message || "Unable to save client.");
    } finally {
      setSaving(false);
    }
  }

  function handleCaseChange(event) {
    const { name, value } = event.target;
    setCaseForm((current) => {
      const next = { ...current, [name]: value };
      if (name === "caseType" && !isStudyPermitCaseType(value)) {
        next.studyIntakeMonth = "";
        if (!caseStagesForType(value).includes(current.stage)) {
          next.stage = "Retainer Pending";
          next.nextAction = getDefaultNextAction("Retainer Pending");
        }
      }
      if (name === "stage" && !current.nextAction) next.nextAction = getDefaultNextAction(value);
      return next;
    });
  }

  async function submitCase(event) {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      const payload = { ...caseForm, idempotencyKey: caseKey, assignedUserId: caseForm.assignedUserId || "", studyIntakeMonth: isStudyPermitCaseType(caseForm.caseType) ? studyIntakeApiValue(caseForm.studyIntakeMonth) : null, nextAction: caseForm.nextAction.trim() || getDefaultNextAction(caseForm.stage) };
      if (!payload.assignedUserId) delete payload.assignedUserId;
      if (!payload.submittedAt) delete payload.submittedAt;
      if (!payload.decisionAt) delete payload.decisionAt;
      const response = await api.post("/cases", payload);
      const createdCase = response.data.data || response.data;
      onClose();
      navigate(`/app/cases/${encodeURIComponent(createdCase.id)}`);
    } catch (error) {
      setFormError(error.response?.data?.message || error.message || "Unable to save case.");
    } finally {
      setSaving(false);
    }
  }

  if (kind === "client") {
    return <ClientDrawer formState={clientForm} onChange={handleClientChange} onSubmit={submitClient} onCancel={close} saving={saving} formError={formError} users={users} isEditing={false} closing={closing} showFrontDeskActions={role === "frontdesk"} frontDeskIntake={{ action: "client-only", bookAppointmentAfterPayment: true }} onFrontDeskIntakeChange={() => {}} canRecordProfessionalFee={false} nameNeedsReview={false} contactMatches={contactMatches} checkingContact={checkingContact} onOpenExistingClient={(client) => { onClose(); navigate(`/app/clients/${client.id}`); }} onBookExistingClient={(client) => { onClose(); navigate(`/app/calendar?bookForClient=${encodeURIComponent(client.id)}`); }} dobError={dobError} onDobBlur={() => setDobError(dateOfBirthError(clientForm.dateOfBirth))} />;
  }

  if (kind === "case") {
    return <CaseFormDrawer formState={caseForm} onChange={handleCaseChange} onSubmit={submitCase} onCancel={close} saving={saving} formError={formError} clients={clients} users={users} caseTypeOptions={caseTypeOptions} isEditing={false} editingClientName="" closing={closing} />;
  }

  return null;
}
