import {
  CalendarDays,
  Ban,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  ListTodo,
  Plus,
  Save,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import api from "../../services/api";
import { getWorkflowPriorityStyles } from "./caseProfileUtils";

const priorities = ["Low", "Normal", "High", "Urgent"];
const inputClass =
  "mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100/60";

function localDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function localTime(value) {
  if (!value) return "17:00";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "17:00";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function initialTask(task, defaultAssigneeId) {
  return {
    title: task?.title || "",
    description: task?.description || "",
    assignedToId: task?.assignedToId || defaultAssigneeId || "",
    priority: task?.priority || "Normal",
    dueDate: localDate(task?.dueAt),
    dueTime: localTime(task?.dueAt),
    status: task?.status || "Pending",
  };
}

function formatDueDate(value) {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No due date";
  return date.toLocaleString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isOverdue(task) {
  return (
    task.status === "Pending" &&
    task.dueAt &&
    new Date(task.dueAt).getTime() < Date.now()
  );
}

function TaskEditorOverlay({
  task,
  users,
  defaultAssigneeId,
  saving,
  error,
  onClose,
  onSave,
  onRequestDelete,
}) {
  const [values, setValues] = useState(() =>
    initialTask(task, defaultAssigneeId),
  );
  useEffect(
    () => setValues(initialTask(task, defaultAssigneeId)),
    [task, defaultAssigneeId],
  );
  const update = (key, value) =>
    setValues((current) => ({ ...current, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    const dueAt = values.dueDate
      ? new Date(`${values.dueDate}T${values.dueTime || "17:00"}`).toISOString()
      : null;
    try {
      await onSave({
        title: values.title.trim(),
        description: values.description.trim() || null,
        assignedToId: values.assignedToId || null,
        priority: values.priority,
        status: values.status,
        dueAt,
      });
    } catch {
      // Keep the form open so the inline API error remains visible.
    }
  };
  return createPortal(
    <div className="fixed inset-0 z-[410] flex items-center justify-center bg-slate-950/25 p-3 backdrop-blur-md">
      <button
        type="button"
        className="absolute inset-0"
        onClick={onClose}
        aria-label="Close task form"
      />
      <motion.form
        initial={{ opacity: 0, y: 18, scale: 0.975 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.985 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        onSubmit={submit}
        className="relative flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white/96 shadow-[0_32px_100px_rgba(15,23,42,0.28)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-600">
              Case task
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
              {task ? "Edit task" : "Create a new task"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Assign the work, set its priority, and keep its due date visible
              to the case team.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <main className="scrollbar-hidden min-h-0 flex-1 space-y-4 overflow-y-auto bg-slate-50/55 p-5">
          {error ? (
            <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </p>
          ) : null}
          <section className="rounded-[1.5rem] border border-slate-100 bg-white p-4 shadow-sm">
            <label className="block text-sm font-semibold text-slate-800">
              Task title
              <input
                autoFocus
                required
                maxLength={180}
                value={values.title}
                onChange={(event) => update("title", event.target.value)}
                placeholder="Review client passport and expiry date"
                className={inputClass}
              />
            </label>
            <label className="mt-4 block text-sm font-semibold text-slate-800">
              Description{" "}
              <span className="font-normal text-slate-400">(optional)</span>
              <textarea
                rows={4}
                maxLength={4000}
                value={values.description}
                onChange={(event) => update("description", event.target.value)}
                placeholder="Add instructions, context, or the expected outcome…"
                className={`${inputClass} resize-none`}
              />
            </label>
          </section>
          <section className="rounded-[1.5rem] border border-slate-100 bg-white p-4 shadow-sm">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-semibold text-slate-800">
                Assigned to
                <select
                  value={values.assignedToId}
                  onChange={(event) =>
                    update("assignedToId", event.target.value)
                  }
                  className="select-field mt-2 w-full"
                >
                  <option value="">Unassigned</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.fullName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-semibold text-slate-800">
                Priority
                <select
                  value={values.priority}
                  onChange={(event) => update("priority", event.target.value)}
                  className="select-field mt-2 w-full"
                >
                  {priorities.map((priority) => (
                    <option key={priority}>{priority}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-semibold text-slate-800">
                Due date
                <input
                  type="date"
                  value={values.dueDate}
                  onChange={(event) => update("dueDate", event.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="block text-sm font-semibold text-slate-800">
                Due time
                <input
                  type="time"
                  disabled={!values.dueDate}
                  value={values.dueTime}
                  onChange={(event) => update("dueTime", event.target.value)}
                  className={`${inputClass} disabled:bg-slate-50 disabled:text-slate-400`}
                />
              </label>
            </div>
            {task ? (
              <label className="mt-4 block text-sm font-semibold text-slate-800">
                Status
                <select
                  value={values.status}
                  onChange={(event) => update("status", event.target.value)}
                  className="select-field mt-2 w-full"
                >
                  <option value="Pending">Open</option>
                  <option value="Completed">Completed</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
              </label>
            ) : null}
          </section>
        </main>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-5 py-4">
          {task && task.status !== "Cancelled" ? (
            <button
              type="button"
              onClick={onRequestDelete}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold text-rose-600 transition hover:bg-rose-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Cancel task
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 text-xs text-slate-400">
              <ListTodo className="h-4 w-4" />
              Saved directly to this case
            </span>
          )}
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !values.title.trim()}
              className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_25px_rgba(15,23,42,0.18)] disabled:opacity-45"
            >
              <Save className="h-4 w-4" />
              {saving ? "Saving…" : task ? "Save changes" : "Create task"}
            </button>
          </div>
        </footer>
      </motion.form>
    </div>,
    document.body,
  );
}

function DeleteTaskOverlay({ task, saving, error, onClose, onConfirm }) {
  return createPortal(
    <div className="fixed inset-0 z-[430] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-md">
      <button
        type="button"
        className="absolute inset-0"
        onClick={onClose}
        aria-label="Keep task open"
      />
      <motion.section
        initial={{ opacity: 0, y: 12, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative w-full max-w-sm rounded-[1.8rem] border border-white/80 bg-white p-6 shadow-[0_28px_80px_rgba(15,23,42,0.25)]"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
          <Trash2 className="h-5 w-5" />
        </span>
        <h3 className="mt-4 text-lg font-semibold text-slate-950">
          Cancel this task?
        </h3>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          “{task.title}” will leave the open queue but remain available in the
          cancelled list and case activity history.
        </p>
        {error ? (
          <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </p>
        ) : null}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700"
          >
            Keep task
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Cancelling…" : "Cancel task"}
          </button>
        </div>
      </motion.section>
    </div>,
    document.body,
  );
}

export default function TasksWorkspace({
  tasks,
  caseItem,
  highlightId,
  onCreate,
  onUpdate,
  onDelete,
}) {
  const [view, setView] = useState("open");
  const [editorTask, setEditorTask] = useState(undefined);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api
      .get("/leads/staff")
      .then((response) => {
        if (active) setUsers(response.data.data || []);
      })
      .catch(() => {
        if (active)
          setUsers(caseItem.assignedUser ? [caseItem.assignedUser] : []);
      });
    return () => {
      active = false;
    };
  }, [caseItem.assignedUser]);
  const counts = useMemo(
    () => ({
      open: tasks.filter((task) => task.status === "Pending").length,
      completed: tasks.filter((task) => task.status === "Completed").length,
      cancelled: tasks.filter((task) => task.status === "Cancelled").length,
      overdue: tasks.filter(isOverdue).length,
    }),
    [tasks],
  );
  const visible = useMemo(
    () =>
      tasks
        .filter((task) => task.status === (view === "open" ? "Pending" : view === "completed" ? "Completed" : "Cancelled"))
        .sort((left, right) => {
          if (view === "completed")
            return (
              new Date(right.completedAt || right.updatedAt) -
              new Date(left.completedAt || left.updatedAt)
            );
          if (!left.dueAt) return 1;
          if (!right.dueAt) return -1;
          return new Date(left.dueAt) - new Date(right.dueAt);
        }),
    [tasks, view],
  );
  useEffect(() => {
    if (!highlightId) return undefined;
    const frame = requestAnimationFrame(() => {
      document.getElementById(`case-task-${highlightId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [highlightId, visible]);
  const save = async (values) => {
    try {
      setSaving(true);
      setError("");
      if (editorTask) await onUpdate(editorTask, values);
      else await onCreate(values);
      setEditorTask(undefined);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          `Unable to ${editorTask ? "update" : "create"} the task.`,
      );
      throw requestError;
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    try {
      setSaving(true);
      setError("");
      await onDelete(deleteTarget);
      setDeleteTarget(null);
      setEditorTask(undefined);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message || "Unable to cancel the task.",
      );
    } finally {
      setSaving(false);
    }
  };
  const toggle = async (task) => {
    try {
      setSaving(true);
      setError("");
      await onUpdate(task, { status: task.status === "Pending" ? "Completed" : "Pending" });
    } catch (requestError) {
      setError(
        requestError.response?.data?.message || "Unable to update the task.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white shadow-[0_18px_55px_rgba(15,23,42,0.07)]">
      <header className="border-b border-slate-100 bg-[linear-gradient(135deg,#ffffff,#f8fafc)] px-5 py-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-600">
              Case work
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
              Tasks
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Create, assign, and complete work without leaving the case file.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setError("");
              setEditorTask(null);
            }}
            className="inline-flex w-fit items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(15,23,42,0.18)] transition hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" />
            New Task
          </button>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-2">
          <div className="rounded-2xl border border-white bg-white px-3 py-2.5 shadow-sm">
            <p className="text-lg font-semibold text-slate-900">
              {counts.open}
            </p>
            <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              Open
            </p>
          </div>
          <div className="rounded-2xl border border-white bg-white px-3 py-2.5 shadow-sm">
            <p className="text-lg font-semibold text-rose-600">
              {counts.overdue}
            </p>
            <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              Overdue
            </p>
          </div>
          <div className="rounded-2xl border border-white bg-white px-3 py-2.5 shadow-sm">
            <p className="text-lg font-semibold text-emerald-600">
              {counts.completed}
            </p>
            <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              Completed
            </p>
          </div>
          <div className="rounded-2xl border border-white bg-white px-3 py-2.5 shadow-sm">
            <p className="text-lg font-semibold text-slate-500">{counts.cancelled}</p>
            <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400">Cancelled</p>
          </div>
        </div>
      </header>
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="relative grid grid-cols-3 rounded-full bg-slate-100 p-1">
          {[
            ["open", "Open"],
            ["completed", "Completed"],
            ["cancelled", "Cancelled"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              className={`relative z-10 rounded-full px-4 py-1.5 text-xs font-semibold transition ${view === id ? "text-slate-950" : "text-slate-500"}`}
            >
              {view === id ? (
                <motion.span
                  layoutId="task-view-pill"
                  className="absolute inset-0 -z-10 rounded-full bg-white shadow-sm"
                  transition={{ type: "spring", stiffness: 500, damping: 38 }}
                />
              ) : null}
              {label}
            </button>
          ))}
        </div>
        {error && !editorTask && !deleteTarget ? (
          <p className="text-xs font-medium text-rose-600">{error}</p>
        ) : null}
      </div>
      <div className="divide-y divide-slate-100">
        {visible.map((task) => {
          const overdue = isOverdue(task);
          return (
            <article
              key={task.id}
              id={`case-task-${task.id}`}
              className={`group flex items-center gap-3 px-4 py-3.5 transition hover:bg-slate-50/70 ${task.id === highlightId ? "ring-4 ring-sky-200/80" : ""}`}
            >
              <button
                type="button"
                onClick={() => toggle(task)}
                disabled={saving}
                aria-label={
                  task.status === "Completed"
                    ? `Reopen ${task.title}`
                    : task.status === "Cancelled" ? `Reopen ${task.title}` : `Complete ${task.title}`
                }
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition ${task.status === "Completed" ? "bg-emerald-500 text-white" : task.status === "Cancelled" ? "bg-slate-200 text-slate-500 hover:bg-sky-100 hover:text-sky-600" : "border border-slate-200 bg-white text-slate-300 hover:border-emerald-300 hover:text-emerald-500"}`}
              >
                {task.status === "Completed" ? (
                  <Check className="h-4 w-4" />
                ) : task.status === "Cancelled" ? (
                  <Ban className="h-4 w-4" />
                ) : (
                  <Circle className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setError("");
                  setEditorTask(task);
                }}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-sm font-semibold ${task.status !== "Pending" ? "text-slate-500 line-through decoration-slate-300" : "text-slate-900"}`}
                  >
                    {task.title}
                  </span>
                  {task.description ? (
                    <span className="mt-1 block truncate text-xs text-slate-500">
                      {task.description}
                    </span>
                  ) : null}
                  <span className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-medium text-slate-400">
                    <span
                      className={`inline-flex items-center gap-1 ${overdue ? "font-semibold text-rose-600" : ""}`}
                    >
                      <CalendarDays className="h-3 w-3" />
                      {formatDueDate(task.dueAt)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <UserRound className="h-3 w-3" />
                      {task.assignedTo?.fullName || (caseItem.assignedUser?.fullName ? `${caseItem.assignedUser.fullName} (case owner)` : "Unassigned")}
                    </span>
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${getWorkflowPriorityStyles(task.priority)}`}
                >
                  {task.priority}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />
              </button>
            </article>
          );
        })}
        {!visible.length ? (
          <div className="px-6 py-14 text-center">
            <span
              className={`mx-auto flex h-12 w-12 items-center justify-center rounded-2xl ${view === "completed" ? "bg-emerald-50 text-emerald-500" : "bg-sky-50 text-sky-500"}`}
            >
              {view === "completed" ? (
                <CheckCircle2 className="h-6 w-6" />
              ) : view === "cancelled" ? (
                <Ban className="h-6 w-6" />
              ) : (
                <ListTodo className="h-6 w-6" />
              )}
            </span>
            <h3 className="mt-3 text-sm font-semibold text-slate-900">
              {view === "completed"
                ? "No completed tasks yet"
                : view === "cancelled"
                  ? "No cancelled tasks"
                : "No open tasks"}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {view === "completed"
                ? "Completed work will appear here."
                : view === "cancelled"
                  ? "Cancelled work remains visible here for reference."
                : "Create the first task for this case."}
            </p>
            {view === "open" ? (
              <button
                type="button"
                onClick={() => setEditorTask(null)}
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white"
              >
                <Plus className="h-4 w-4" />
                New Task
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <AnimatePresence>
        {editorTask !== undefined ? (
          <TaskEditorOverlay
            task={editorTask}
            users={users}
            defaultAssigneeId={
              caseItem.assignedUserId || caseItem.assignedUser?.id
            }
            saving={saving}
            error={error}
            onClose={() => {
              if (!saving) {
                setEditorTask(undefined);
                setError("");
              }
            }}
            onSave={save}
            onRequestDelete={() => setDeleteTarget(editorTask)}
          />
        ) : null}
      </AnimatePresence>
      {deleteTarget ? (
        <DeleteTaskOverlay
          task={deleteTarget}
          saving={saving}
          error={error}
          onClose={() => {
            if (!saving) {
              setDeleteTarget(null);
              setError("");
            }
          }}
          onConfirm={remove}
        />
      ) : null}
    </section>
  );
}
