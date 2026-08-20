import {
  Check,
  Handshake,
  Loader2,
  Search,
  ShieldCheck,
  UserRoundCheck,
  UsersRound,
  UserSquare2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../services/api";
import {
  getCaseRoleAssignments,
  getCaseRoles,
  replaceCaseRoleAssignments,
} from "../../api/caseRoleApi";

const requiredCodes = new Set(["rcic", "case-worker"]);

function PersonLine({ person, detail }) {
  if (!person) return null;
  return (
    <div className="mt-3 flex items-center gap-3 rounded-xl bg-white/80 px-3 py-2.5 ring-1 ring-slate-100">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-950 text-xs font-bold text-white">
        {(person.fullName || "?").slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-slate-900">{person.fullName}</span>
        <span className="block truncate text-xs text-slate-500">{detail || person.email || "Team member"}</span>
      </span>
    </div>
  );
}

export default function CaseRolesOverlay({ caseItem, onClose, onSaved }) {
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState(null);
  const [optionalAssignments, setOptionalAssignments] = useState([]);
  const [rcicUserId, setRcicUserId] = useState("");
  const [caseWorkerUserId, setCaseWorkerUserId] = useState("");
  const [collaboratorUserIds, setCollaboratorUserIds] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event) => event.key === "Escape" && !saving && onClose();
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, saving]);

  useEffect(() => {
    let active = true;
    Promise.all([
      getCaseRoles(),
      getCaseRoleAssignments(caseItem.id),
      api.get(`/cases/${caseItem.id}/permissions`).then((response) => response.data.data),
    ])
      .then(([roleList, assignmentList, collaboration]) => {
        if (!active) return;
        setRoles(roleList || []);
        setPermissions(collaboration);
        setRcicUserId(collaboration.requiredTeam?.rcic?.id || "");
        setCaseWorkerUserId(collaboration.requiredTeam?.caseWorker?.id || collaboration.owner?.id || "");
        setCollaboratorUserIds((collaboration.collaborators || []).map((item) => item.id));
        setOptionalAssignments(
          assignmentList
            .filter((item) => !requiredCodes.has(item.caseRole?.code))
            .map((item) => ({ caseRoleId: item.caseRoleId, userId: item.user.id })),
        );
      })
      .catch((reason) => active && setError(reason.response?.data?.message || "Case collaboration could not be loaded."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [caseItem.id]);

  const canManage = Boolean(permissions?.canManageCollaboration) && !permissions?.archived;
  const optionalRoles = useMemo(() => roles.filter((role) => !requiredCodes.has(role.code)), [roles]);
  const people = permissions?.consultants || [];
  const visiblePeople = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return people.filter((item) => !needle || `${item.fullName} ${item.email || ""} ${item.jobTitle || ""}`.toLowerCase().includes(needle));
  }, [people, query]);
  const additionalPeople = visiblePeople.filter((person) => person.id !== rcicUserId && person.id !== caseWorkerUserId);
  const selectedRcic = (permissions?.requiredTeam?.rcicUsers || []).find((person) => person.id === rcicUserId) || permissions?.requiredTeam?.rcic || null;
  const selectedCaseWorker = (permissions?.requiredTeam?.caseWorkerUsers || []).find((person) => person.id === caseWorkerUserId) || permissions?.requiredTeam?.caseWorker || permissions?.owner || null;
  const requiredComplete = Boolean(rcicUserId && caseWorkerUserId);

  function toggleCollaborator(userId) {
    if (!canManage) return;
    setMessage("");
    setCollaboratorUserIds((current) => current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]);
  }

  function toggleOptionalRole(caseRoleId, userId) {
    if (!canManage) return;
    setMessage("");
    setOptionalAssignments((current) => {
      const exists = current.some((item) => item.caseRoleId === caseRoleId && item.userId === userId);
      if (exists) return current.filter((item) => !(item.caseRoleId === caseRoleId && item.userId === userId));
      return [...current, { caseRoleId, userId }];
    });
  }

  async function save() {
    if (!canManage) return;
    if (!rcicUserId) {
      setError("Every case must have an RCIC.");
      return;
    }
    if (!caseWorkerUserId) {
      setError("Every case must have a Case Worker.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const collaborationResponse = await api.put(`/cases/${caseItem.id}/permissions`, {
        rcicUserId,
        caseWorkerUserId,
        collaboratorUserIds: collaboratorUserIds.filter((id) => id !== rcicUserId && id !== caseWorkerUserId),
      });
      const nextCollaboration = collaborationResponse.data.data;
      const requiredRoleAssignments = [
        { caseRoleId: nextCollaboration.requiredTeam.roles.rcic.id, userId: rcicUserId },
        { caseRoleId: nextCollaboration.requiredTeam.roles.caseWorker.id, userId: caseWorkerUserId },
      ];
      await replaceCaseRoleAssignments(caseItem.id, [...requiredRoleAssignments, ...optionalAssignments]);

      setPermissions(nextCollaboration);
      setRcicUserId(nextCollaboration.requiredTeam?.rcic?.id || rcicUserId);
      setCaseWorkerUserId(nextCollaboration.requiredTeam?.caseWorker?.id || caseWorkerUserId);
      setCollaboratorUserIds((nextCollaboration.collaborators || []).map((item) => item.id));
      setMessage("Collaboration updated.");
      onSaved?.(nextCollaboration);
    } catch (reason) {
      setError(reason.response?.data?.message || "Case collaboration could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[360] flex flex-col bg-slate-100/95 backdrop-blur-xl" role="dialog" aria-modal="true" aria-labelledby="case-collaboration-title">
      <header className="shrink-0 border-b border-white/80 bg-white/92 px-4 py-3 shadow-sm sm:px-6 sm:py-4">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-600"><Handshake className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-600">Collaboration</p>
              <h2 id="case-collaboration-title" className="truncate text-lg font-semibold text-slate-950">{caseItem.client?.fullName || "Client"} · {caseItem.caseType}</h2>
              <p className="mt-0.5 text-xs text-slate-500">Required RCIC, Case Worker, case access and additional case roles in one place.</p>
            </div>
          </div>
          <button type="button" disabled={saving} onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 disabled:opacity-50" aria-label="Close collaboration"><X className="h-5 w-5" /></button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-6">
        <div className="mx-auto w-full max-w-6xl space-y-5">
          {loading ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-violet-500" /></div> : null}
          {!loading && permissions ? (
            <>
              {!requiredComplete ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
                  This existing case is missing its required team. Assign both an RCIC and a Case Worker before saving collaboration.
                </div>
              ) : null}

              {!permissions.canManageCollaboration ? (
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                  Collaboration is read-only for your account. Administrators and staff assigned the RCIC team role can manage it.
                </div>
              ) : null}

              <section className="grid gap-4 lg:grid-cols-2">
                <article className="rounded-[1.6rem] border border-violet-100 bg-violet-50/70 p-5 shadow-sm">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-violet-600 ring-1 ring-violet-100"><ShieldCheck className="h-5 w-5" /></span>
                    <div>
                      <div className="flex items-center gap-2"><h3 className="font-semibold text-violet-950">RCIC</h3><span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-700">Required</span></div>
                      <p className="mt-1 text-sm leading-5 text-violet-800">Regulated representative responsible for the immigration file. Automatically receives collaboration access.</p>
                    </div>
                  </div>
                  {canManage ? (
                    <select value={rcicUserId} onChange={(event) => { setRcicUserId(event.target.value); setError(""); }} className="mt-4 h-12 w-full rounded-2xl border border-violet-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100">
                      <option value="">Choose RCIC</option>
                      {(permissions.requiredTeam?.rcicUsers || []).map((person) => <option key={person.id} value={person.id}>{person.fullName}{person.licenseNumber ? ` · ${person.licenseNumber}` : ""}</option>)}
                    </select>
                  ) : <PersonLine person={selectedRcic} detail={selectedRcic?.licenseNumber ? `RCIC · ${selectedRcic.licenseNumber}` : "RCIC"} />}
                  {canManage && selectedRcic ? <PersonLine person={selectedRcic} detail={selectedRcic.licenseNumber ? `RCIC · ${selectedRcic.licenseNumber}` : "RCIC"} /> : null}
                </article>

                <article className="rounded-[1.6rem] border border-sky-100 bg-sky-50/70 p-5 shadow-sm">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-sky-600 ring-1 ring-sky-100"><UserRoundCheck className="h-5 w-5" /></span>
                    <div>
                      <div className="flex items-center gap-2"><h3 className="font-semibold text-sky-950">Case Worker</h3><span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-700">Required</span></div>
                      <p className="mt-1 text-sm leading-5 text-sky-800">Owns the day-to-day file and becomes the primary case owner throughout CaseDesk.</p>
                    </div>
                  </div>
                  {canManage ? (
                    <select value={caseWorkerUserId} onChange={(event) => { setCaseWorkerUserId(event.target.value); setError(""); }} className="mt-4 h-12 w-full rounded-2xl border border-sky-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100">
                      <option value="">Choose Case Worker</option>
                      {(permissions.requiredTeam?.caseWorkerUsers || []).map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}
                    </select>
                  ) : <PersonLine person={selectedCaseWorker} detail="Case Worker · Primary owner" />}
                  {canManage && selectedCaseWorker ? <PersonLine person={selectedCaseWorker} detail="Case Worker · Primary owner" /> : null}
                </article>
              </section>

              <section className="rounded-[1.6rem] border border-white bg-white p-5 shadow-sm sm:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"><UsersRound className="h-5 w-5" /></span>
                    <div><h3 className="font-semibold text-slate-950">Additional collaborators</h3><p className="mt-1 text-sm text-slate-500">Extra staff who can open and work on this case. RCIC access is automatic and the Case Worker already owns the case.</p></div>
                  </div>
                  <label className="relative block w-full sm:w-72"><Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search staff" className="h-10 w-full rounded-full border border-slate-200 pl-10 pr-4 text-sm outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-100" /></label>
                </div>
                <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {additionalPeople.map((person) => {
                    const selected = collaboratorUserIds.includes(person.id);
                    return (
                      <button key={person.id} type="button" disabled={!canManage || saving} onClick={() => toggleCollaborator(person.id)} className={["flex items-center gap-3 rounded-2xl border p-3.5 text-left transition", selected ? "border-emerald-200 bg-emerald-50/70" : "border-slate-200 bg-white hover:border-slate-300", !canManage ? "cursor-default" : ""].join(" ")}>
                        <span className={["flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold", selected ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500"].join(" ")}>{(person.fullName || "?").slice(0, 1).toUpperCase()}</span>
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-900">{person.fullName}</span><span className="block truncate text-xs text-slate-500">{person.jobTitle || person.email || "Staff"}</span></span>
                        {selected ? <Check className="h-4 w-4 shrink-0 text-emerald-600" /> : null}
                      </button>
                    );
                  })}
                </div>
                {!additionalPeople.length ? <p className="mt-4 rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">No additional staff match this search.</p> : null}
              </section>

              {optionalRoles.length ? (
                <section className="rounded-[1.6rem] border border-white bg-white p-5 shadow-sm sm:p-6">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-teal-50 text-teal-600"><UserSquare2 className="h-5 w-5" /></span>
                    <div><h3 className="font-semibold text-slate-950">Additional case roles</h3><p className="mt-1 text-sm text-slate-500">Optional attribution such as Reviewer. RCIC and Case Worker are managed above and cannot be removed here.</p></div>
                  </div>
                  <div className="mt-5 space-y-4">
                    {optionalRoles.map((role) => (
                      <div key={role.id} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                        <h4 className="text-sm font-semibold text-slate-900">{role.name}</h4>
                        {role.description ? <p className="mt-1 text-xs text-slate-500">{role.description}</p> : null}
                        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {visiblePeople.map((person) => {
                            const selected = optionalAssignments.some((item) => item.caseRoleId === role.id && item.userId === person.id);
                            return (
                              <button key={person.id} type="button" disabled={!canManage || saving} onClick={() => toggleOptionalRole(role.id, person.id)} className={["flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition", selected ? "border-teal-200 bg-teal-50" : "border-slate-200 bg-white", !canManage ? "cursor-default" : ""].join(" ")}>
                                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{person.fullName}</span>{selected ? <Check className="h-4 w-4 text-teal-600" /> : null}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {permissions.archived ? <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">Restore this case before changing collaboration.</p> : null}
            </>
          ) : null}
          {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}
          {message ? <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{message}</p> : null}
        </div>
      </main>

      {!loading && permissions ? (
        <footer className="shrink-0 border-t border-slate-200/80 bg-white/95 px-4 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] backdrop-blur">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3">
            <span className="text-xs text-slate-500">{requiredComplete ? "Required team assigned" : "RCIC and Case Worker required"}</span>
            <div className="flex gap-2"><button type="button" disabled={saving} onClick={onClose} className="h-11 rounded-full px-5 text-sm font-semibold text-slate-600 hover:bg-slate-100">{canManage ? "Cancel" : "Close"}</button>{canManage ? <button type="button" disabled={saving || !requiredComplete} onClick={save} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-slate-950 px-6 text-sm font-semibold text-white shadow-lg disabled:opacity-40">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Handshake className="h-4 w-4" />}{saving ? "Saving…" : "Save collaboration"}</button> : null}</div>
          </div>
        </footer>
      ) : null}
    </div>,
    document.body,
  );
}
