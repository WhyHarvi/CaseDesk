import { useState } from "react";
import { Clock3, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import api from "../../services/api";

function initials(name) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "CD";
}

function requestDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function RestrictedCaseAccess({ preview, onChange }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = preview.pendingRequest;

  async function requestAccess() {
    setBusy(true);
    setError("");
    try {
      const response = await api.post(`/cases/${preview.id}/access-requests`, { note: reason });
      onChange({ ...preview, accessStatus: "Pending", pendingRequest: response.data.data });
      setDialogOpen(false);
      setReason("");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to send this request.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelRequest() {
    if (!pending?.id) return;
    setBusy(true);
    setError("");
    try {
      await api.delete(`/cases/${preview.id}/access-requests/${pending.id}`);
      onChange({ ...preview, accessStatus: "Restricted", pendingRequest: null });
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to cancel this request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[58vh] max-w-3xl items-center justify-center py-8">
      <section className="w-full overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.10)]">
        <div className="border-b border-slate-100 bg-gradient-to-br from-slate-950 to-slate-800 px-6 py-7 text-white sm:px-8">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
              <LockKeyhole className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="flex flex-col gap-2">
              <Badge className="border-white/15 bg-white/10 text-white">Restricted access</Badge>
              <div>
                <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">This case belongs to another team member</h1>
                <p className="mt-1 max-w-xl text-sm leading-6 text-slate-300">Request collaborator access to help with this case. Private documents, notes, finances, and activity remain hidden until approval.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6 px-6 py-7 sm:px-8">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Case</p>
              <p className="mt-2 font-semibold text-slate-950">{preview.clientName}</p>
              <p className="mt-1 text-sm text-slate-500">{preview.caseType || "Case type unavailable"}</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Primary assignee</p>
              <div className="mt-2 flex items-center gap-2.5">
                <Avatar className="bg-white">
                  <AvatarFallback>{initials(preview.owner?.fullName)}</AvatarFallback>
                </Avatar>
                <span className="font-semibold text-slate-950">{preview.owner?.fullName || "Unassigned"}</span>
              </div>
            </div>
          </div>

          {pending ? (
            <div className="flex flex-col gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
                <div>
                  <p className="font-semibold text-amber-950">Access requested</p>
                  <p className="mt-1 text-sm text-amber-800">Waiting for an Admin, the case RCIC, or a reviewer{pending.createdAt ? ` · ${requestDate(pending.createdAt)}` : ""}.</p>
                </div>
              </div>
              <Button variant="outline" disabled={busy} onClick={cancelRequest} className="border-amber-300 bg-white text-amber-900">Cancel request</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3 text-sm text-slate-500">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
                <p>Your request grants collaborator access only. It will never replace the primary assignee.</p>
              </div>
              <Button size="lg" onClick={() => setDialogOpen(true)} className="bg-sky-600 text-white hover:bg-sky-700">
                <UserRound data-icon="inline-start" /> Request access
              </Button>
            </div>
          )}
          {error ? <p role="alert" className="text-sm font-medium text-rose-600">{error}</p> : null}
        </div>
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request collaborator access</DialogTitle>
            <DialogDescription>Tell the approver why you need access to {preview.clientName} — {preview.caseType}. The reason is optional.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <label htmlFor="case-access-reason" className="text-sm font-medium text-slate-800">Reason <span className="font-normal text-slate-400">(optional)</span></label>
            <Textarea id="case-access-reason" value={reason} maxLength={500} rows={4} onChange={(event) => setReason(event.target.value)} placeholder="I am covering this case while the assigned consultant is unavailable." className="border-slate-200 bg-white" />
            <p className="text-right text-xs text-slate-400">{reason.length}/500</p>
          </div>
          {error ? <p role="alert" className="text-sm font-medium text-rose-600">{error}</p> : null}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button disabled={busy} onClick={requestAccess} className="bg-sky-600 text-white hover:bg-sky-700">{busy ? "Sending…" : "Send request"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
