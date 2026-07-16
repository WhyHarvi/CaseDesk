import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Bold,
  BookTemplate,
  Check,
  Clock3,
  FileText,
  Italic,
  Link2,
  List,
  ListOrdered,
  Printer,
  Redo2,
  Save,
  Settings2,
  Signature,
  Table2,
  Underline,
  Undo2,
  X,
} from "lucide-react";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TextAlign from "@tiptap/extension-text-align";
import UnderlineExtension from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, useEditor } from "@tiptap/react";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../services/api";
import { createDocxFile } from "../utils/writtenDocumentExport";

const toolButton =
  "flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 disabled:opacity-35";
const templates = [
  {
    id: "client-letter",
    title: "Client Letter",
    description: "Professional correspondence with greeting and closing.",
    html: "<p>Dear Client,</p><p><br></p><p>Re: Your immigration matter</p><p><br></p><p>We are writing regarding your application. </p><p><br></p><p>Sincerely,</p><p>Case Consultant</p>",
  },
  {
    id: "submission",
    title: "Submission Cover Letter",
    description: "Structured representative submission to IRCC.",
    html: "<h1>Written Submissions</h1><p><strong>Applicant:</strong> </p><p><strong>Application:</strong> </p><h2>Overview</h2><p></p><h2>Relevant Facts</h2><p></p><h2>Supporting Evidence</h2><p></p><h2>Conclusion</h2><p></p>",
  },
  {
    id: "affidavit",
    title: "Affidavit Outline",
    description: "Numbered affidavit structure ready for facts.",
    html: "<h1>Affidavit</h1><p>I, [Full Name], of the City of [City], MAKE OATH AND SAY:</p><ol><li><p>I am the affiant and have personal knowledge of the matters set out below.</p></li><li><p></p></li></ol><p>SWORN before me at __________</p><p>this ____ day of __________, 20__.</p>",
  },
];

function ModalShell({ children, onClose, maxWidth = "max-w-md" }) {
  return (
    <div className="fixed inset-0 z-[450] flex items-center justify-center bg-slate-950/20 p-4 backdrop-blur-md">
      <button
        type="button"
        className="absolute inset-0"
        onClick={onClose}
        aria-label="Close"
      />
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className={`relative w-full ${maxWidth} overflow-hidden rounded-[1.75rem] border border-white/80 bg-white/95 shadow-[0_30px_90px_rgba(15,23,42,0.24)]`}
      >
        {children}
      </motion.div>
    </div>
  );
}

export default function DocumentComposer() {
  const { id, writtenDocumentId } = useParams();
  const navigate = useNavigate();
  const [caseItem, setCaseItem] = useState(null);
  const [writtenDocument, setWrittenDocument] = useState(null);
  const [title, setTitle] = useState("Untitled Document");
  const [headerText, setHeaderText] = useState("");
  const [footerText, setFooterText] = useState("");
  const [showPageNumbers, setShowPageNumbers] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  const [autosaveState, setAutosaveState] = useState("Saved");
  const [savedAt, setSavedAt] = useState(null);
  const [saveDialog, setSaveDialog] = useState(null);
  const [saveAsName, setSaveAsName] = useState("");
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [signatureName, setSignatureName] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const revisionRef = useRef(0);
  const hydratingRef = useRef(true);

  function markChanged() {
    if (hydratingRef.current) return;
    revisionRef.current += 1;
    setRevision(revisionRef.current);
    setDirty(true);
    setAutosaveState("Unsaved");
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false, underline: false }),
      UnderlineExtension,
      Link.configure({ openOnClick: false, autolink: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder: "Start writing your document…" }),
    ],
    content: "",
    onUpdate: markChanged,
    editorProps: {
      attributes: {
        class:
          "min-h-[880px] outline-none text-[15px] leading-7 text-slate-800",
      },
    },
  });

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        setLoading(true);
        const caseResponse = await api.get(`/cases/${id}`);
        if (!active) return;
        setCaseItem(caseResponse.data.data);
        let writer;
        if (writtenDocumentId) {
          writer = (await api.get(`/written-documents/${writtenDocumentId}`))
            .data.data;
        } else {
          writer = (
            await api.post("/written-documents", {
              caseId: id,
              title: "Untitled Document",
              contentHtml: "",
            })
          ).data.data;
          navigate(`/cases/${id}/documents/${writer.id}/edit`, {
            replace: true,
          });
        }
        if (!active) return;
        hydratingRef.current = true;
        setWrittenDocument(writer);
        setTitle(writer.title);
        setHeaderText(writer.headerText || "");
        setFooterText(writer.footerText || "");
        setShowPageNumbers(writer.showPageNumbers !== false);
        editor?.commands.setContent(writer.contentHtml || "", {
          emitUpdate: false,
        });
        setDirty(false);
        setAutosaveState("Saved");
        setTimeout(() => {
          hydratingRef.current = false;
        }, 0);
      } catch (requestError) {
        setError(
          requestError.response?.data?.message ||
            "Unable to open this written document.",
        );
      } finally {
        if (active) setLoading(false);
      }
    }
    if (editor) load();
    return () => {
      active = false;
    };
  }, [editor, id, navigate, writtenDocumentId]);

  useEffect(() => {
    if (!writtenDocument?.id || !editor || !dirty || hydratingRef.current)
      return undefined;
    const capturedRevision = revisionRef.current;
    const timeout = setTimeout(async () => {
      try {
        setAutosaveState("Saving…");
        const response = await api.patch(
          `/written-documents/${writtenDocument.id}/draft`,
          {
            title,
            contentHtml: editor.getHTML(),
            headerText,
            footerText,
            showPageNumbers,
          },
        );
        setWrittenDocument(response.data.data);
        if (revisionRef.current === capturedRevision) {
          setDirty(false);
          setAutosaveState("Draft saved");
        }
      } catch (requestError) {
        setAutosaveState("Autosave failed");
        setError(
          requestError.response?.data?.message ||
            "Unable to autosave this draft.",
        );
      }
    }, 1400);
    return () => clearTimeout(timeout);
  }, [
    dirty,
    editor,
    footerText,
    headerText,
    revision,
    showPageNumbers,
    title,
    writtenDocument?.id,
  ]);

  useEffect(() => {
    function warnBeforeClose(event) {
      if (!dirty && autosaveState !== "Saving…") return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeClose);
    return () => window.removeEventListener("beforeunload", warnBeforeClose);
  }, [autosaveState, dirty]);

  function updateSetting(setter, value) {
    setter(value);
    markChanged();
  }

  async function saveDocument(name, saveAsCopy = false) {
    if (!editor || !caseItem || !writtenDocument) return;
    const html = editor.getHTML();
    if (editor.isEmpty) {
      setError("Write some content before saving the document.");
      return;
    }
    try {
      setSaving(true);
      setProgress(5);
      setError("");
      const safeTitle = name.trim() || "Untitled Document";
      let targetWriter = writtenDocument;
      if (saveAsCopy) {
        targetWriter = (
          await api.post("/written-documents", {
            caseId: id,
            title: safeTitle,
            contentHtml: html,
            headerText,
            footerText,
            showPageNumbers,
          })
        ).data.data;
      } else {
        await api.patch(`/written-documents/${targetWriter.id}/draft`, {
          title: safeTitle,
          contentHtml: html,
          headerText,
          footerText,
          showPageNumbers,
        });
      }
      setProgress(25);
      const file = await createDocxFile({
        title: safeTitle,
        html,
        headerText,
        footerText,
        showPageNumbers,
      });
      const formData = new FormData();
      formData.append("file", file);
      if (targetWriter.clientDocument?.id && !saveAsCopy)
        formData.append("documentId", targetWriter.clientDocument.id);
      else {
        formData.append("clientId", caseItem.clientId || caseItem.client?.id);
        formData.append("caseId", id);
        formData.append("documentName", safeTitle);
        formData.append("visibility", "Internal");
      }
      const uploaded = await api.post("/client-documents/upload", formData, {
        timeout: 60000,
        onUploadProgress: (event) => {
          if (event.total)
            setProgress(25 + Math.round((event.loaded / event.total) * 55));
        },
      });
      const versionResponse = await api.post(
        `/written-documents/${targetWriter.id}/versions`,
        {
          clientDocumentId: uploaded.data.data.id,
          title: safeTitle,
          contentHtml: html,
          headerText,
          footerText,
          showPageNumbers,
        },
      );
      setProgress(100);
      setSaveDialog(null);
      setSavedAt(new Date());
      setDirty(false);
      setAutosaveState("Saved");
      if (saveAsCopy)
        navigate(`/cases/${id}/documents/${targetWriter.id}/edit`, {
          replace: true,
        });
      setWrittenDocument(versionResponse.data.data);
      setTitle(safeTitle);
      try {
        const channel = new BroadcastChannel("casedesk-documents");
        channel.postMessage({ caseId: id, action: "saved" });
        channel.close();
      } catch {
        localStorage.setItem(
          "casedesk:document-created",
          `${id}:${Date.now()}`,
        );
      }
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          requestError.message ||
          "Unable to save this document.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function restoreVersion(version) {
    try {
      const response = await api.post(
        `/written-documents/${writtenDocument.id}/versions/${version.id}/restore`,
      );
      const restored = response.data.data;
      hydratingRef.current = true;
      setWrittenDocument(restored);
      setTitle(restored.title);
      setHeaderText(restored.headerText || "");
      setFooterText(restored.footerText || "");
      setShowPageNumbers(restored.showPageNumbers !== false);
      editor.commands.setContent(restored.contentHtml || "", {
        emitUpdate: false,
      });
      setVersionsOpen(false);
      setDirty(true);
      setAutosaveState("Restored — unsaved");
      setTimeout(() => {
        hydratingRef.current = false;
        markChanged();
      }, 0);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Unable to restore this version.",
      );
    }
  }

  async function updateCorrespondenceStatus(status) {
    if (!writtenDocument?.correspondenceKind) return;
    try {
      setSaving(true);
      setError("");
      const response = await api.patch(
        `/correspondence/documents/${writtenDocument.id}/status`,
        { status },
      );
      setWrittenDocument(response.data.data);
      try {
        const channel = new BroadcastChannel("casedesk-documents");
        channel.postMessage({ caseId: id, action: "correspondence-status" });
        channel.close();
      } catch {
        localStorage.setItem(
          "casedesk:document-created",
          `${id}:${Date.now()}`,
        );
      }
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Unable to update the correspondence status.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading || !editor)
    return (
      <div className="flex h-screen items-center justify-center bg-[#f3f4f6] text-sm text-slate-500">
        Opening CaseDesk Writer…
      </div>
    );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#e9eaed] text-slate-900">
      <style>{`@media print{.writer-chrome{display:none!important}.writer-scroll{overflow:visible!important;padding:0!important}.writer-page{box-shadow:none!important;margin:0!important;min-height:auto!important}.writer-page-header,.writer-page-footer{display:block!important}}`}</style>
      <header className="writer-chrome border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(`/cases/${id}`)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
              aria-label="Back to case"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <input
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    markChanged();
                  }}
                  className="min-w-0 flex-1 truncate bg-transparent text-base font-semibold outline-none"
                  aria-label="Document title"
                />
                {writtenDocument?.correspondenceKind ? (
                  <span
                    className={`hidden shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold sm:inline ${writtenDocument.correspondenceKind === "Agreement" ? "bg-indigo-50 text-indigo-700" : "bg-sky-50 text-sky-700"}`}
                  >
                    {writtenDocument.correspondenceKind}
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {caseItem?.client?.fullName || "Client"} ·{" "}
                {caseItem?.caseType || "Case"} ·{" "}
                {writtenDocument?.clientDocument
                  ? `Version ${writtenDocument.versions?.[0]?.versionNumber || 1}`
                  : "Draft"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {writtenDocument?.correspondenceKind ? (
              <select
                value={writtenDocument.correspondenceStatus || "Draft"}
                onChange={(event) =>
                  updateCorrespondenceStatus(event.target.value)
                }
                disabled={saving}
                className="hidden h-9 rounded-xl border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 outline-none md:block"
              >
                <option value="Draft">Draft</option>
                <option value="ReadyToIssue">Ready to Issue</option>
                <option value="Issued">Issued</option>
                <option value="Signed">Signed</option>
                <option value="Finalized">Finalized</option>
              </select>
            ) : null}
            <span
              className={`hidden text-xs font-semibold sm:inline ${autosaveState.includes("failed") ? "text-rose-600" : autosaveState === "Saving…" ? "text-sky-600" : "text-slate-400"}`}
            >
              {autosaveState}
            </span>
            {savedAt ? (
              <span className="hidden items-center gap-1 text-xs text-emerald-700 lg:inline-flex">
                <Check className="h-3.5 w-3.5" />
                Saved
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setSaveAsName(title === "Untitled Document" ? "" : title);
                setSaveDialog(
                  writtenDocument?.clientDocument ? "copy" : "save",
                );
              }}
              className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"
            >
              Save As
            </button>
            <button
              type="button"
              onClick={() =>
                writtenDocument?.clientDocument
                  ? saveDocument(title, false)
                  : (setSaveAsName(title === "Untitled Document" ? "" : title),
                    setSaveDialog("save"))
              }
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              {saving ? `Saving ${progress}%` : "Save"}
            </button>
          </div>
        </div>
      </header>
      <div className="writer-chrome border-b border-slate-200 bg-white/80 px-4 py-2">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-1">
          <button
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            className={toolButton}
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            className={toolButton}
          >
            <Redo2 className="h-4 w-4" />
          </button>
          <span className="mx-1 h-6 w-px bg-slate-200" />
          <select
            onChange={(event) => {
              const value = event.target.value;
              if (value === "p") editor.chain().focus().setParagraph().run();
              else
                editor
                  .chain()
                  .focus()
                  .toggleHeading({ level: Number(value) })
                  .run();
            }}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs"
          >
            <option value="p">Normal</option>
            <option value="1">Title</option>
            <option value="2">Heading</option>
            <option value="3">Subheading</option>
          </select>
          <button
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`${toolButton} ${editor.isActive("bold") ? "bg-slate-950 text-white" : ""}`}
          >
            <Bold className="h-4 w-4" />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`${toolButton} ${editor.isActive("italic") ? "bg-slate-950 text-white" : ""}`}
          >
            <Italic className="h-4 w-4" />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            className={`${toolButton} ${editor.isActive("underline") ? "bg-slate-950 text-white" : ""}`}
          >
            <Underline className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              setLinkUrl(editor.getAttributes("link").href || "");
              setLinkOpen(true);
            }}
            className={toolButton}
          >
            <Link2 className="h-4 w-4" />
          </button>
          <span className="mx-1 h-6 w-px bg-slate-200" />
          <button
            onClick={() => editor.chain().focus().setTextAlign("left").run()}
            className={toolButton}
          >
            <AlignLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => editor.chain().focus().setTextAlign("center").run()}
            className={toolButton}
          >
            <AlignCenter className="h-4 w-4" />
          </button>
          <button
            onClick={() => editor.chain().focus().setTextAlign("right").run()}
            className={toolButton}
          >
            <AlignRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={toolButton}
          >
            <List className="h-4 w-4" />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={toolButton}
          >
            <ListOrdered className="h-4 w-4" />
          </button>
          <button
            onClick={() =>
              editor
                .chain()
                .focus()
                .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                .run()
            }
            className={toolButton}
          >
            <Table2 className="h-4 w-4" />
          </button>
          <span className="mx-1 h-6 w-px bg-slate-200" />
          <button
            onClick={() => setTemplatesOpen(true)}
            className={toolButton}
            title="Insert template"
          >
            <BookTemplate className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              setSignatureName(caseItem?.assignedTo?.fullName || "");
              setSignatureOpen(true);
            }}
            className={toolButton}
            title="Insert signature"
          >
            <Signature className="h-4 w-4" />
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className={toolButton}
            title="Page setup"
          >
            <Settings2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => setVersionsOpen(true)}
            className={toolButton}
            title="Version history"
          >
            <Clock3 className="h-4 w-4" />
          </button>
          <button
            onClick={() => window.print()}
            className={toolButton}
            title="Print or save PDF"
          >
            <Printer className="h-4 w-4" />
          </button>
        </div>
      </div>
      {error ? (
        <div className="writer-chrome mx-auto mt-3 flex w-full max-w-4xl items-center justify-between rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
          <span>{error}</span>
          <button onClick={() => setError("")}>
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      <main className="writer-scroll min-h-0 flex-1 overflow-y-auto p-6">
        <div className="writer-page relative mx-auto min-h-[1056px] w-full max-w-[816px] bg-white px-[72px] py-[72px] shadow-[0_14px_40px_rgba(15,23,42,0.14)]">
          <div className="writer-page-header absolute inset-x-[72px] top-7 border-b border-slate-100 pb-2 text-center text-[10px] text-slate-400">
            {headerText}
          </div>
          <EditorContent
            editor={editor}
            className="[&_.is-editor-empty:first-child:before]:pointer-events-none [&_.is-editor-empty:first-child:before]:float-left [&_.is-editor-empty:first-child:before]:h-0 [&_.is-editor-empty:first-child:before]:text-slate-300 [&_.is-editor-empty:first-child:before]:content-[attr(data-placeholder)] [&_.ProseMirror_blockquote]:border-l-4 [&_.ProseMirror_blockquote]:border-slate-200 [&_.ProseMirror_blockquote]:pl-4 [&_.ProseMirror_h1]:mb-5 [&_.ProseMirror_h1]:text-3xl [&_.ProseMirror_h1]:font-bold [&_.ProseMirror_h2]:mb-3 [&_.ProseMirror_h2]:mt-6 [&_.ProseMirror_h2]:text-xl [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_li]:ml-6 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_p]:mb-3 [&_.ProseMirror_table]:my-4 [&_.ProseMirror_table]:w-full [&_.ProseMirror_table]:border-collapse [&_.ProseMirror_td]:border [&_.ProseMirror_td]:border-slate-300 [&_.ProseMirror_td]:p-2 [&_.ProseMirror_th]:border [&_.ProseMirror_th]:border-slate-300 [&_.ProseMirror_th]:bg-slate-50 [&_.ProseMirror_th]:p-2 [&_.ProseMirror_ul]:list-disc"
          />
          <div className="writer-page-footer absolute inset-x-[72px] bottom-7 flex justify-center gap-2 border-t border-slate-100 pt-2 text-[10px] text-slate-400">
            <span>{footerText}</span>
            {showPageNumbers ? (
              <span>{footerText ? "·" : ""} Page 1</span>
            ) : null}
          </div>
        </div>
      </main>
      {saveDialog ? (
        <ModalShell onClose={() => setSaveDialog(null)}>
          <div className="px-6 pb-5 pt-6">
            <div className="flex items-start gap-4">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-sky-50 text-sky-600">
                <FileText className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  {saveDialog === "copy"
                    ? "Save a copy"
                    : "Save to My Documents"}
                </p>
                <h3 className="mt-1 text-lg font-semibold">
                  Name your document
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  A genuine Word DOCX file will be stored in CaseDesk.
                </p>
              </div>
            </div>
            <input
              autoFocus
              value={saveAsName}
              onChange={(event) => setSaveAsName(event.target.value)}
              className="mt-5 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-sky-400"
              placeholder="Document name"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-slate-100 bg-slate-50/70 p-4">
            <button
              onClick={() => setSaveDialog(null)}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={() => saveDocument(saveAsName, saveDialog === "copy")}
              disabled={!saveAsName.trim() || saving}
              className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving
                ? `Saving ${progress}%`
                : saveDialog === "copy"
                  ? "Save Copy"
                  : "Save Document"}
            </button>
          </div>
        </ModalShell>
      ) : null}
      {templatesOpen ? (
        <ModalShell onClose={() => setTemplatesOpen(false)} maxWidth="max-w-xl">
          <div className="flex items-center justify-between px-6 pt-6">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-600">
                Insert template
              </p>
              <h3 className="mt-1 text-lg font-semibold">
                Document building blocks
              </h3>
            </div>
            <button onClick={() => setTemplatesOpen(false)}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-3 p-6">
            {templates.map((template) => (
              <button
                key={template.id}
                onClick={() => {
                  editor.chain().focus().insertContent(template.html).run();
                  setTemplatesOpen(false);
                }}
                className="rounded-2xl border border-slate-200 p-4 text-left transition hover:border-sky-200 hover:bg-sky-50/40"
              >
                <p className="text-sm font-semibold">{template.title}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {template.description}
                </p>
              </button>
            ))}
          </div>
        </ModalShell>
      ) : null}
      {settingsOpen ? (
        <ModalShell onClose={() => setSettingsOpen(false)}>
          <div className="flex items-center justify-between px-6 pt-6">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Page setup
              </p>
              <h3 className="mt-1 text-lg font-semibold">Header and footer</h3>
            </div>
            <button onClick={() => setSettingsOpen(false)}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-4 p-6">
            <label className="block text-sm font-semibold">
              Header
              <input
                value={headerText}
                onChange={(event) =>
                  updateSetting(setHeaderText, event.target.value)
                }
                className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-normal"
              />
            </label>
            <label className="block text-sm font-semibold">
              Footer
              <input
                value={footerText}
                onChange={(event) =>
                  updateSetting(setFooterText, event.target.value)
                }
                className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-normal"
              />
            </label>
            <label className="flex items-center justify-between rounded-2xl bg-slate-50 p-4 text-sm font-semibold">
              Show page numbers
              <button
                type="button"
                onClick={() =>
                  updateSetting(setShowPageNumbers, !showPageNumbers)
                }
                className={`relative h-7 w-12 rounded-full transition ${showPageNumbers ? "bg-slate-950" : "bg-slate-300"}`}
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${showPageNumbers ? "left-6" : "left-1"}`}
                />
              </button>
            </label>
          </div>
        </ModalShell>
      ) : null}
      {signatureOpen ? (
        <ModalShell onClose={() => setSignatureOpen(false)}>
          <div className="px-6 pb-6 pt-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">
              Signature block
            </p>
            <h3 className="mt-1 text-lg font-semibold">
              Insert a typed signature
            </h3>
            <input
              autoFocus
              value={signatureName}
              onChange={(event) => setSignatureName(event.target.value)}
              className="mt-5 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm"
              placeholder="Signer name"
            />
            <button
              onClick={() => {
                editor
                  .chain()
                  .focus()
                  .insertContent(
                    `<p><br></p><p><em>Electronically signed by</em></p><p><strong>${signatureName.replace(/[<>&]/g, "")}</strong></p><p>____________________________</p>`,
                  )
                  .run();
                setSignatureOpen(false);
              }}
              disabled={!signatureName.trim()}
              className="mt-4 w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              Insert Signature
            </button>
          </div>
        </ModalShell>
      ) : null}
      {linkOpen ? (
        <ModalShell onClose={() => setLinkOpen(false)}>
          <div className="px-6 pb-6 pt-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-600">
              Link
            </p>
            <h3 className="mt-1 text-lg font-semibold">Add a hyperlink</h3>
            <input
              autoFocus
              value={linkUrl}
              onChange={(event) => setLinkUrl(event.target.value)}
              className="mt-5 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm"
              placeholder="https://example.com"
            />
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                  editor.chain().focus().unsetLink().run();
                  setLinkOpen(false);
                }}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold"
              >
                Remove Link
              </button>
              <button
                onClick={() => {
                  editor
                    .chain()
                    .focus()
                    .extendMarkRange("link")
                    .setLink({ href: linkUrl })
                    .run();
                  setLinkOpen(false);
                }}
                disabled={!linkUrl.trim()}
                className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                Apply Link
              </button>
            </div>
          </div>
        </ModalShell>
      ) : null}
      {versionsOpen ? (
        <ModalShell onClose={() => setVersionsOpen(false)} maxWidth="max-w-xl">
          <div className="flex items-center justify-between px-6 pt-6">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-600">
                Version history
              </p>
              <h3 className="mt-1 text-lg font-semibold">Saved versions</h3>
            </div>
            <button onClick={() => setVersionsOpen(false)}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="max-h-[65vh] space-y-2 overflow-y-auto p-6">
            {writtenDocument?.versions?.map((version) => (
              <div
                key={version.id}
                className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 p-4"
              >
                <div>
                  <p className="text-sm font-semibold">
                    Version {version.versionNumber} · {version.title}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {version.createdBy?.fullName || "Staff"} ·{" "}
                    {new Date(version.createdAt).toLocaleString()}
                  </p>
                </div>
                <button
                  onClick={() => restoreVersion(version)}
                  className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold"
                >
                  Restore
                </button>
              </div>
            ))}
            {!writtenDocument?.versions?.length ? (
              <p className="py-10 text-center text-sm text-slate-500">
                Save the document to create its first version.
              </p>
            ) : null}
          </div>
        </ModalShell>
      ) : null}
    </div>
  );
}
