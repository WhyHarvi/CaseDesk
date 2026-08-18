import { Loader2, Search, UserSquare2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../services/api";
import { getCaseRoleAssignments, getCaseRoles, replaceCaseRoleAssignments } from "../../api/caseRoleApi";

export default function CaseRolesOverlay({ caseItem, onClose, onSaved }) {
  const [roles, setRoles] = useState(null);
  const [people, setPeople] = useState([]);
  const [assignments, setAssignments] = useState([]);
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
      .then(([roleList, assignmentList, permissions]) => {
        if (!active) return;
        setRoles(roleList);
        setAssignments(assignmentList.map((item) => ({ caseRoleId: item.caseRoleId, userId: item.user.id })));
        const owner = permissions.owner ? [permissions.owner] : [];
        const known = new Map([...owner, ...permissions.collaborators, ...permissions.consultants].map((person) => [person.id, person]));
        setPeople([...known.values()]);
      })
      .catch((reason) => active && setError(reason.response?.data?.message || "Case roles could not be loaded."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [caseItem.id]);

  const visiblePeople = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return people.filter((item) => !needle || `${item.fullName} ${item.email || ""}`.toLowerCase().includes(needle));
  }, [people, query]);

  function toggle(caseRoleId, userId) {
    setMessage("");
    setAssignments((current) => {
      const exists = current.some((item) => item.caseRoleId === caseRoleId && item.userId === userId);
      if (exists) return current.filter((item) => !(item.caseRoleId === caseRoleId && item.userId === userId));
      return [...current, { caseRoleId, userId }];
    });
  }

  async function save() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const data = await replaceCaseRoleAssignments(caseItem.id, assignments);
      setAssignments(data.map((item) => ({ caseRoleId: item.caseRoleId, userId: item.user.id })));
      setMessage("Case roles updated.");
      onSaved?.(data);
    } catch (reason) {
      setError(reason.response?.data?.message || "Case roles could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[360] flex flex-col bg-slate-100/95 backdrop-blur-xl" role="dialog" aria-modal="true" aria-labelledby="case-roles-title">
      <header className="shrink-0 border-b border-white/80 bg-white/92 px-4 py-3 shadow-sm sm:px-6 sm:py-4">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600"><UserSquare2 className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-600">Incentive roles</p>
              <h2 id="case-roles-title" className="truncate text-lg font-semibold text-slate-950">{caseItem.client?.fullName || "Client"} · {caseItem.caseType}</h2>
            </div>
          </div>
          <button type="button" disabled={saving} onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 disabled:opacity-50" aria-label="Close case roles"><X className="h-5 w-5" /></button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-6">
        <div className="mx-auto w-full max-w-5xl space-y-4">
          {loading ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /></div> : null}
          {!loading && roles ? (
            roles.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">No case roles are set up yet. An administrator can add roles like "RCIC" or "Case Worker" in Settings → Case Roles.</p>
            ) : (
              <>
                <aside className="rounded-[1.75rem] border border-indigo-100 bg-indigo-50/80 p-5">
                  <UserSquare2 className="h-5 w-5 text-indigo-600" />
                  <h3 className="mt-3 font-semibold text-indigo-950">What this controls</h3>
                  <p className="mt-2 text-sm leading-6 text-indigo-800">Who's credited on this case for incentive purposes, and in what role. This is separate from case access — removing someone here doesn't change what they can see or work on.</p>
                </aside>

                <label className="relative block w-full sm:w-72"><Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search staff" className="h-10 w-full rounded-full border border-slate-200 pl-10 pr-4 text-base outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-100" /></label>

                {roles.map((role) => (
                  <section key={role.id} className="rounded-[1.75rem] border border-white bg-white p-5 shadow-sm sm:p-6">
                    <h3 className="font-semibold text-slate-950">{role.name}</h3>
                    {role.description ? <p className="mt-1 text-sm text-slate-500">{role.description}</p> : null}
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {visiblePeople.map((person) => {
                        const selected = assignments.some((item) => item.caseRoleId === role.id && item.userId === person.id);
                        return (
                          <button key={person.id} type="button" disabled={saving} onClick={() => toggle(role.id, person.id)} className={["flex items-center gap-3 rounded-2xl border p-3.5 text-left transition", selected ? "border-indigo-200 bg-indigo-50/70" : "border-slate-200 hover:border-slate-300"].join(" ")}>
                            <span className={["flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold", selected ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"].join(" ")}>{person.fullName.slice(0, 1).toUpperCase()}</span>
                            <span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-900">{person.fullName}</span><span className="block truncate text-xs text-slate-500">{person.email || ""}</span></span>
                          </button>
                        );
                      })}
                    </div>
                    {!visiblePeople.length ? <p className="mt-3 rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">No staff match this search.</p> : null}
                  </section>
                ))}
              </>
            )
          ) : null}
          {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}
          {message ? <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{message}</p> : null}
        </div>
      </main>

      {!loading && roles?.length ? (
        <footer className="shrink-0 border-t border-slate-200/80 bg-white/95 px-4 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] backdrop-blur">
          <div className="mx-auto flex w-full max-w-5xl justify-end gap-2"><button type="button" disabled={saving} onClick={onClose} className="h-11 rounded-full px-5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button type="button" disabled={saving} onClick={save} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-slate-950 px-6 text-sm font-semibold text-white shadow-lg disabled:opacity-40">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserSquare2 className="h-4 w-4" />}{saving ? "Saving…" : "Save roles"}</button></div>
        </footer>
      ) : null}
    </div>,
    document.body,
  );
}
