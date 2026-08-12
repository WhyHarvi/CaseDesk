import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { Camera, Check, Loader2, LogOut, Pencil, Search, UserPlus, Users, X } from "lucide-react";
import {
  addInternalChatParticipants,
  getMyColleagues,
  internalChatErrorMessage,
  removeInternalChatParticipant,
  updateInternalChatThread,
} from "../../api/internalChatApi";

const initials = (name) =>
  String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

function MemberRow({ member, isSelf, onRemove, removing }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl px-3 py-2.5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-600 to-indigo-600 text-xs font-bold text-white">
        {initials(member.fullName)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">
          {member.fullName}
          {isSelf ? " (You)" : ""}
        </span>
        <span className="block truncate text-xs capitalize text-slate-500">{member.role}</span>
      </span>
      <button
        type="button"
        onClick={onRemove}
        disabled={removing}
        aria-label={isSelf ? "Leave group" : `Remove ${member.fullName}`}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
      >
        {removing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isSelf ? <LogOut className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

// Opened by tapping a group's name/avatar in ChatsPage.jsx (groups only —
// DMs and client conversations don't get this). Two views in one modal:
// the profile (photo, name, member list) and an "add people" picker that
// reuses the same search-a-colleague pattern as NewChatModal.
export default function GroupProfilePanel({ thread, avatarUrl, myUserId, onClose, onUpdated, onLeave }) {
  const [view, setView] = useState("profile");
  const [nameDraft, setNameDraft] = useState(thread.name || "");
  const [editingName, setEditingName] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [removingId, setRemovingId] = useState("");
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  const [colleagues, setColleagues] = useState([]);
  const [colleaguesLoading, setColleaguesLoading] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [selectedToAdd, setSelectedToAdd] = useState([]);
  const [adding, setAdding] = useState(false);

  const memberIds = useMemo(() => new Set(thread.participants.map((member) => member.id)), [thread.participants]);

  function openAddView() {
    setView("add");
    setSelectedToAdd([]);
    setAddSearch("");
    setError("");
    if (!colleagues.length) {
      setColleaguesLoading(true);
      getMyColleagues().then(setColleagues).catch(() => {}).finally(() => setColleaguesLoading(false));
    }
  }

  const addCandidates = useMemo(() => {
    const query = addSearch.trim().toLowerCase();
    return colleagues.filter(
      (user) => !memberIds.has(user.id) && (!query || user.fullName.toLowerCase().includes(query) || user.email.toLowerCase().includes(query)),
    );
  }, [colleagues, memberIds, addSearch]);

  function toggleAddSelection(user) {
    setSelectedToAdd((current) =>
      current.some((item) => item.id === user.id) ? current.filter((item) => item.id !== user.id) : [...current, user],
    );
  }

  async function saveName() {
    const nextName = nameDraft.trim();
    if (!nextName || nextName === thread.name) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    setError("");
    try {
      await updateInternalChatThread(thread.id, { name: nextName });
      setEditingName(false);
      onUpdated?.();
    } catch (reason) {
      setError(internalChatErrorMessage(reason, "The group name could not be updated."));
    } finally {
      setSavingName(false);
    }
  }

  async function pickAvatar(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploadingAvatar(true);
    setError("");
    try {
      await updateInternalChatThread(thread.id, { avatarFile: file });
      onUpdated?.({ avatarChanged: true });
    } catch (reason) {
      setError(internalChatErrorMessage(reason, "The group photo could not be updated."));
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function confirmAdd() {
    if (!selectedToAdd.length) return;
    setAdding(true);
    setError("");
    try {
      await addInternalChatParticipants(thread.id, selectedToAdd.map((user) => user.id));
      setView("profile");
      onUpdated?.();
    } catch (reason) {
      setError(internalChatErrorMessage(reason, "Those colleagues could not be added."));
    } finally {
      setAdding(false);
    }
  }

  async function removeMember(member) {
    const isSelf = member.id === myUserId;
    if (!window.confirm(isSelf ? "Leave this group?" : `Remove ${member.fullName} from this group?`)) return;
    setRemovingId(member.id);
    setError("");
    try {
      await removeInternalChatParticipant(thread.id, member.id);
      if (isSelf) onLeave?.();
      else onUpdated?.();
    } catch (reason) {
      setError(internalChatErrorMessage(reason, "That person could not be removed."));
    } finally {
      setRemovingId("");
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      <div
        className="fixed inset-0 z-[520] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
        onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ duration: 0.18 }}
          className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-[1.75rem] border border-white/70 bg-white shadow-2xl"
        >
          <header className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-950">{view === "add" ? "Add people" : "Group info"}</h2>
            <button
              type="button"
              onClick={() => (view === "add" ? setView("profile") : onClose())}
              className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
              aria-label="Close"
            >
              <X className="h-4.5 w-4.5" />
            </button>
          </header>

          {error ? <p className="mx-5 mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}

          {view === "profile" ? (
            <>
              <div className="flex flex-col items-center gap-3 px-5 py-6">
                <div className="relative">
                  <span className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-2xl font-bold text-white">
                    {avatarUrl ? <img src={avatarUrl} alt={thread.name} className="h-full w-full object-cover" /> : <Users className="h-9 w-9" />}
                  </span>
                  <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={pickAvatar} />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingAvatar}
                    aria-label="Change group photo"
                    className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-slate-950 text-white shadow-lg transition hover:bg-slate-800 disabled:opacity-50"
                  >
                    {uploadingAvatar ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                  </button>
                </div>
                {editingName ? (
                  <div className="flex w-full items-center gap-2">
                    <input
                      autoFocus
                      value={nameDraft}
                      onChange={(event) => setNameDraft(event.target.value)}
                      maxLength={120}
                      onKeyDown={(event) => event.key === "Enter" && saveName()}
                      className="h-10 flex-1 rounded-xl border border-slate-200 px-3 text-center text-sm outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
                    />
                    <button type="button" onClick={saveName} disabled={savingName} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-600 text-white disabled:opacity-50">
                      {savingName ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setNameDraft(thread.name || "");
                      setEditingName(true);
                    }}
                    className="flex items-center gap-1.5 text-base font-semibold text-slate-950"
                  >
                    {thread.name}
                    <Pencil className="h-3.5 w-3.5 text-slate-400" />
                  </button>
                )}
                <p className="text-xs text-slate-500">{thread.participants.length} people</p>
              </div>

              <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto border-t border-slate-100 px-3 py-2">
                <button type="button" onClick={openAddView} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sky-600 transition hover:bg-sky-50">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-50"><UserPlus className="h-4.5 w-4.5" /></span>
                  <span className="text-sm font-semibold">Add people</span>
                </button>
                {thread.participants.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    isSelf={member.id === myUserId}
                    onRemove={() => removeMember(member)}
                    removing={removingId === member.id}
                  />
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="shrink-0 px-5 py-3">
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    autoFocus
                    value={addSearch}
                    onChange={(event) => setAddSearch(event.target.value)}
                    placeholder="Search colleagues"
                    className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm outline-none transition focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-100"
                  />
                </label>
              </div>
              {selectedToAdd.length ? (
                <div className="flex shrink-0 flex-wrap gap-1.5 px-5 pb-3">
                  {selectedToAdd.map((user) => (
                    <span key={user.id} className="inline-flex items-center gap-1 rounded-full bg-sky-50 py-1 pl-2.5 pr-1.5 text-xs font-medium text-sky-700">
                      {user.fullName}
                      <button type="button" onClick={() => toggleAddSelection(user)} className="rounded-full p-0.5 hover:bg-sky-100">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                {colleaguesLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
                ) : !addCandidates.length ? (
                  <p className="px-4 py-8 text-center text-sm text-slate-500">Everyone you can add is already in this group.</p>
                ) : (
                  addCandidates.map((user) => {
                    const active = selectedToAdd.some((item) => item.id === user.id);
                    return (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => toggleAddSelection(user)}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-slate-50"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-600 to-indigo-600 text-xs font-bold text-white">
                          {initials(user.fullName)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-900">{user.fullName}</span>
                          <span className="block truncate text-xs capitalize text-slate-500">{user.role}</span>
                        </span>
                        {active ? (
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-600 text-white">
                            <Check className="h-3 w-3" />
                          </span>
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>
              <footer className="shrink-0 border-t border-slate-100 px-5 py-4">
                <button
                  type="button"
                  disabled={!selectedToAdd.length || adding}
                  onClick={confirmAdd}
                  className="flex h-11 w-full items-center justify-center rounded-full bg-sky-600 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-40"
                >
                  {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : selectedToAdd.length ? `Add ${selectedToAdd.length}` : "Add"}
                </button>
              </footer>
            </>
          )}
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body,
  );
}
