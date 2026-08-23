import { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  pointerWithin,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  FolderOpen,
  Folder,
  FolderPlus,
  FolderInput,
  Download,
  Trash2,
  Loader2,
  ArrowLeft,
  Pencil,
  Share2,
  ExternalLink,
  X,
  ChevronRight,
  UploadCloud,
  GripVertical,
} from "lucide-react";
import { FileIcon } from "../components/BrandIcon";
import PdfCanvas from "../components/PdfCanvas";
import {
  useFiles,
  fileObjectUrl,
  downloadUrl,
  shareFileLink,
  FILE_FOLDERS,
  type SavedFile,
  type UserFolder,
} from "../lib/files";
import { isConfigured } from "../lib/supabase";
import { isLocalMode } from "../lib/dataMode";
import { useAuth } from "../lib/auth";
import { useUI } from "../lib/ui";
import {
  PageHeader,
  SearchInput,
  FilterChip,
  EmptyState,
  Modal,
} from "../components/ui";
import { cn } from "../lib/format";

const fmtSize = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(0)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;
const fmtDate = (t: number) =>
  new Date(t).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const toolLabel = (tool: string | null) =>
  FILE_FOLDERS.find((f) => f.key === tool)?.label ?? null;
const toolRoute = (tool: string | null) =>
  FILE_FOLDERS.find((f) => f.key === tool)?.route;

export default function MyFiles() {
  const { user } = useAuth();
  const {
    files,
    folders,
    loading,
    remove,
    rename,
    upload,
    createFolder,
    renameFolder,
    deleteFolder,
    moveFile,
    moveFolder,
  } = useFiles();
  const { toast, confirm, prompt } = useUI();
  const navigate = useNavigate();

  const [cwd, setCwd] = useState<string | null>(null); // current folder (null = root)
  const [preview, setPreview] = useState<SavedFile | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [toolFilter, setToolFilter] = useState<string>("all");
  const [moveFor, setMoveFor] = useState<SavedFile | null>(null);
  const [drag, setDrag] = useState<{ type: string; name: string } | null>(null);
  const [q, setQ] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const foldersById = useMemo(() => {
    const m = new Map<string, UserFolder>();
    for (const f of folders) m.set(f.id, f);
    return m;
  }, [folders]);

  // Folders directly inside the current folder.
  const subfolders = useMemo(
    () => folders.filter((f) => f.parentId === cwd),
    [folders, cwd]
  );

  // Files in the current folder, before the type filter.
  const folderFilesAll = useMemo(
    () => files.filter((f) => f.folderId === cwd),
    [files, cwd]
  );
  // Tool keys present among the current folder's files (for the filter chips).
  const toolsPresent = useMemo(() => {
    const s = new Set<string>();
    for (const f of folderFilesAll) if (f.tool) s.add(f.tool);
    return FILE_FOLDERS.filter((d) => s.has(d.key));
  }, [folderFilesAll]);
  const folderFiles = useMemo(
    () =>
      toolFilter === "all"
        ? folderFilesAll
        : folderFilesAll.filter((f) => (f.tool ?? "other") === toolFilter),
    [folderFilesAll, toolFilter]
  );

  // Name search (DEMO parity) — filters folders and files in the current view.
  const qNorm = q.trim().toLowerCase();
  const visibleFolders = useMemo(
    () =>
      qNorm
        ? subfolders.filter((f) => f.name.toLowerCase().includes(qNorm))
        : subfolders,
    [subfolders, qNorm]
  );
  const visibleFiles = useMemo(
    () =>
      qNorm
        ? folderFiles.filter((f) => f.name.toLowerCase().includes(qNorm))
        : folderFiles,
    [folderFiles, qNorm]
  );

  // Breadcrumb trail from root to the current folder.
  const trail = useMemo(() => {
    const out: UserFolder[] = [];
    const seen = new Set<string>(); // guard against a parentId cycle (concurrent re-parent across synced devices)
    let id = cwd;
    while (id && !seen.has(id)) {
      seen.add(id);
      const f = foldersById.get(id);
      if (!f) break;
      out.unshift(f);
      id = f.parentId;
    }
    return out;
  }, [cwd, foldersById]);

  // All descendant folder ids of a folder (cycle guard when re-parenting).
  const descendantIds = (rootId: string): Set<string> => {
    const out = new Set<string>();
    const stack = [rootId];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const f of folders)
        if (f.parentId === cur && !out.has(f.id)) {
          out.add(f.id);
          stack.push(f.id);
        }
    }
    return out;
  };

  // Flattened folder list (name with depth indent) for the "Move to…" menu.
  const flatFolders = useMemo(() => {
    const out: { id: string; name: string; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const f of folders
        .filter((x) => x.parentId === parent)
        .sort((a, b) => a.name.localeCompare(b.name))) {
        out.push({ id: f.id, name: f.name, depth });
        walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [folders]);

  const isEmptyFolder = (id: string) =>
    !folders.some((f) => f.parentId === id) &&
    !files.some((f) => f.folderId === id);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );

  const doUpload = async (inputFiles: FileList | null) => {
    if (!inputFiles?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(inputFiles)) await upload(file, undefined, cwd);
      toast.success(
        `${inputFiles.length} file${inputFiles.length > 1 ? "s" : ""} uploaded.`
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const newFolder = async () => {
    const name = await prompt({
      title: "New folder",
      label: "Folder name",
      defaultValue: "",
      confirmLabel: "Create",
    });
    if (name == null || !name.trim()) return;
    try {
      await createFolder(name, cwd);
      toast.success("Folder created.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const doRenameFolder = async (f: UserFolder) => {
    const name = await prompt({
      title: "Rename folder",
      label: "Folder name",
      defaultValue: f.name,
      confirmLabel: "Rename",
    });
    if (name == null || !name.trim() || name.trim() === f.name) return;
    try {
      await renameFolder(f.id, name);
      toast.success("Folder renamed.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const doDeleteFolder = async (f: UserFolder) => {
    if (!isEmptyFolder(f.id)) {
      toast.error("Folder isn't empty - move or delete its contents first.");
      return;
    }
    const ok = await confirm({
      title: "Delete folder?",
      message: `“${f.name}” will be removed. It's empty, so no files are lost.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteFolder(f.id);
      toast.success("Folder deleted.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const doMoveFile = async (f: SavedFile, folderId: string | null) => {
    setMoveFor(null);
    if (f.folderId === folderId) return;
    try {
      await moveFile(f.id, folderId);
      toast.success(folderId ? "Moved." : "Moved to root.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const onDragStart = (e: DragStartEvent) => {
    const d = e.active.data.current as { type: string; name: string } | undefined;
    if (d) setDrag({ type: d.type, name: d.name });
  };

  const onDragEnd = async (e: DragEndEvent) => {
    setDrag(null);
    const over = e.over?.id as string | undefined;
    const data = e.active.data.current as { type: string; id: string } | undefined;
    if (!over || !data) return;
    let target: string | null = null;
    if (over.startsWith("folder:")) target = over.slice(7);
    else if (over.startsWith("crumb:")) {
      const c = over.slice(6);
      target = c === "root" ? null : c;
    } else return;

    try {
      if (data.type === "file") {
        if (data.id && target !== undefined) await doMoveFileById(data.id, target);
      } else if (data.type === "folder") {
        if (target === data.id) return; // onto itself
        if (target && descendantIds(data.id).has(target)) {
          toast.error("Can't move a folder into one of its own subfolders.");
          return;
        }
        if ((foldersById.get(data.id)?.parentId ?? null) === target) return; // no-op
        await moveFolder(data.id, target);
        toast.success("Folder moved.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const doMoveFileById = async (fileId: string, folderId: string | null) => {
    const f = files.find((x) => x.id === fileId);
    if (!f || f.folderId === folderId) return;
    await moveFile(fileId, folderId);
    toast.success(folderId ? "Moved." : "Moved to root.");
  };

  const download = async (f: SavedFile) => {
    setBusyId(f.id);
    try {
      const url = await downloadUrl(f);
      if (!url) throw new Error("Could not create a download link.");
      const a = document.createElement("a");
      a.href = url;
      a.download = f.name;
      a.target = "_blank";
      a.rel = "noopener";
      a.click();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const del = async (f: SavedFile) => {
    const ok = await confirm({
      title: "Delete file?",
      message: `“${f.name}” will be permanently removed from your account.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await remove(f);
      if (preview?.id === f.id) setPreview(null);
      toast.success("File deleted.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const doRename = async (f: SavedFile) => {
    const base = f.name.replace(/\.[^.]+$/, "");
    const next = await prompt({
      title: "Rename file",
      label: "File name",
      defaultValue: base,
      confirmLabel: "Rename",
    });
    if (next == null || !next.trim() || next.trim() === base) return;
    try {
      const finalName = await rename(f, next);
      if (preview?.id === f.id) setPreview((p) => (p ? { ...p, name: finalName } : p));
      toast.success("File renamed.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const share = async (f: SavedFile) => {
    if (isLocalMode()) {
      toast.error("Share links need Cloud mode - use Download instead.");
      return;
    }
    setBusyId(f.id);
    try {
      const url = await shareFileLink(f);
      if (!url) throw new Error("Could not create a share link.");
      await navigator.clipboard.writeText(url);
      toast.success("Share link copied - valid for 7 days.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const edit = (f: SavedFile) => {
    const route = toolRoute(f.tool);
    if (!route) {
      toast.info("This file type has no editor.");
      return;
    }
    navigate(route);
  };

  /* ---------------- gates ---------------- */
  if (!isConfigured || !user) {
    return (
      <div className="animate-fade-up">
        <PageHeader
          title="My Files"
          subtitle="Organise documents into folders: drag, drop, and arrange your way"
        />
        <div className="rounded-xl border border-border bg-card p-5 text-[13px] text-muted-foreground">
          Sign in to save and access your files across devices.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="animate-fade-up">
        <PageHeader
          title="My Files"
          subtitle="Organise documents into folders: drag, drop, and arrange your way"
        />
        <div className="grid h-60 place-items-center">
          <Loader2 size={22} className="animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (preview) {
    return (
      <FilePreviewPage
        file={preview}
        onBack={() => setPreview(null)}
        onDownload={() => download(preview)}
        onShare={() => share(preview)}
        onRename={() => doRename(preview)}
        onDelete={() => del(preview)}
        onEdit={() => edit(preview)}
        editable={!!toolRoute(preview.tool)}
      />
    );
  }

  const empty = !folders.length && !files.length;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="animate-fade-up">
        <PageHeader
          title="My Files"
          subtitle="Organise documents into folders: drag, drop, and arrange your way"
          action={
            <div className="flex items-center gap-2">
              <button className="btn-ghost" onClick={newFolder}>
                <FolderPlus size={14} /> New folder
              </button>
              <input
                ref={fileInputRef}
                type="file"
                id="file-upload"
                multiple
                className="hidden"
                onChange={(e) => {
                  doUpload(e.target.files);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              />
              <label
                htmlFor="file-upload"
                className="btn-primary cursor-pointer inline-flex items-center gap-2"
              >
                {uploading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <UploadCloud size={14} />
                )}
                Upload
              </label>
            </div>
          }
        />

        {/* Breadcrumbs (also drop targets to move items up the tree) */}
        <Breadcrumbs trail={trail} onNavigate={setCwd} />

        {empty ? (
          <div className="rounded-xl border border-border bg-card">
            <EmptyState
              icon={FolderOpen}
              title="No saved files yet"
              description="Generate a document - a copy is filed here automatically - or create a folder to organise things your way."
              action={
                <label
                  htmlFor="file-upload"
                  className="btn-primary cursor-pointer inline-flex items-center gap-2"
                >
                  <UploadCloud size={14} /> Upload files
                </label>
              }
            />
          </div>
        ) : (
          <>
            {/* Toolbar: search + type filters + count (DEMO parity) */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <SearchInput
                value={q}
                onChange={setQ}
                placeholder="Search files"
                className="w-[280px]"
              />
              {toolsPresent.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <FilterChip
                    active={toolFilter === "all"}
                    onClick={() => setToolFilter("all")}
                  >
                    All
                  </FilterChip>
                  {toolsPresent.map((d) => (
                    <FilterChip
                      key={d.key}
                      active={toolFilter === d.key}
                      onClick={() => setToolFilter(d.key)}
                    >
                      {d.label}
                    </FilterChip>
                  ))}
                </div>
              )}
              <div className="ml-auto text-[12px] text-muted-foreground">
                {visibleFiles.length} files
              </div>
            </div>

            {/* Subfolders */}
            {visibleFolders.length > 0 && (
              <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {visibleFolders.map((f) => (
                  <FolderCard
                    key={f.id}
                    folder={f}
                    count={
                      files.filter((x) => x.folderId === f.id).length +
                      folders.filter((x) => x.parentId === f.id).length
                    }
                    onOpen={() => {
                      setCwd(f.id);
                      setToolFilter("all");
                    }}
                    onRename={() => doRenameFolder(f)}
                    onDelete={() => doDeleteFolder(f)}
                  />
                ))}
              </div>
            )}

            {/* Files in this folder - quiet joined rows (DEMO parity) */}
            {visibleFiles.length > 0 && (
              <div className="overflow-hidden rounded-xl border border-border bg-card divide-y divide-border">
                {visibleFiles.map((f) => (
                  <FileRow
                    key={f.id}
                    file={f}
                    busy={busyId === f.id}
                    onOpen={() => setPreview(f)}
                    onDownload={() => download(f)}
                    onRename={() => doRename(f)}
                    onShare={() => share(f)}
                    onDelete={() => del(f)}
                    onMove={() => setMoveFor(f)}
                  />
                ))}
              </div>
            )}

            {!visibleFolders.length && !visibleFiles.length && (
              qNorm ? (
                <div className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card py-10 text-center text-[13px] text-muted-foreground">
                  <FolderOpen size={15} /> No files match your search
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-card py-10 text-center text-[13px] text-muted-foreground">
                  This folder is empty. Drag files here or upload.
                </div>
              )
            )}
          </>
        )}
      </div>

      {/* Drag preview chip */}
      <DragOverlay dropAnimation={null}>
        {drag ? (
          <div className="rounded-lg border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-foreground shadow-lg">
            {drag.type === "folder" ? (
              <Folder size={13} className="mr-1 inline" />
            ) : (
              <FileIcon name={drag.name} className="mr-1 inline h-3.5 w-3.5" />
            )}
            {drag.name}
          </div>
        ) : null}
      </DragOverlay>

      {/* Move-to menu */}
      {moveFor && (
        <MoveMenu
          file={moveFor}
          folders={flatFolders}
          onPick={(folderId) => doMoveFile(moveFor, folderId)}
          onClose={() => setMoveFor(null)}
        />
      )}
    </DndContext>
  );
}

/* ---------------- Breadcrumbs ---------------- */

function Breadcrumbs({
  trail,
  onNavigate,
}: {
  trail: UserFolder[];
  onNavigate: (id: string | null) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1 text-[13px]">
      <CrumbDrop id="root" onClick={() => onNavigate(null)} label="My Files" root />
      {trail.map((f) => (
        <span key={f.id} className="flex items-center gap-1">
          <ChevronRight size={13} className="text-muted-foreground/60" />
          <CrumbDrop id={f.id} onClick={() => onNavigate(f.id)} label={f.name} />
        </span>
      ))}
    </div>
  );
}

function CrumbDrop({
  id,
  label,
  onClick,
  root,
}: {
  id: string;
  label: string;
  onClick: () => void;
  root?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `crumb:${id}` });
  return (
    <button
      ref={setNodeRef}
      onClick={onClick}
      className={cn(
        "rounded-md px-2 py-1 transition-colors cursor-pointer",
        isOver
          ? "bg-primary-500/15 text-primary-600 dark:text-primary-400"
          : "text-muted-foreground hover:bg-hover hover:text-foreground",
        root && "font-medium text-foreground"
      )}
    >
      {label}
    </button>
  );
}

/* ---------------- Folder card (drag source + drop target) ---------------- */

function FolderCard({
  folder,
  count,
  onOpen,
  onRename,
  onDelete,
}: {
  folder: UserFolder;
  count: number;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: `folder:${folder.id}` });
  const {
    setNodeRef: dragRef,
    attributes,
    listeners,
    isDragging,
  } = useDraggable({
    id: `folderdrag:${folder.id}`,
    data: { type: "folder", id: folder.id, name: folder.name },
  });
  const ref = (node: HTMLElement | null) => {
    dropRef(node);
    dragRef(node);
  };
  return (
    <div
      ref={ref}
      className={cn(
        "group flex items-center gap-2 rounded-xl border bg-card px-3.5 py-3 transition-colors",
        isOver
          ? "border-primary-400 ring-2 ring-primary-500/20"
          : "border-border hover:bg-hover",
        isDragging && "opacity-40"
      )}
    >
      <span
        {...attributes}
        {...listeners}
        className="cursor-grab text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing"
        title="Drag to move"
      >
        <GripVertical size={14} />
      </span>
      <button
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left cursor-pointer"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Folder size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-foreground">
            {folder.name}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {count} item{count === 1 ? "" : "s"}
          </p>
        </div>
      </button>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-100 transition-opacity">
        <RowAction title="Rename" onClick={onRename}>
          <Pencil size={14} />
        </RowAction>
        <RowAction title="Delete" tone="danger" onClick={onDelete}>
          <Trash2 size={14} />
        </RowAction>
      </div>
    </div>
  );
}

/* ---------------- File row (drag source) ---------------- */

function FileRow({
  file,
  busy,
  onOpen,
  onDownload,
  onRename,
  onShare,
  onDelete,
  onMove,
}: {
  file: SavedFile;
  busy: boolean;
  onOpen: () => void;
  onDownload: () => void;
  onRename: () => void;
  onShare: () => void;
  onDelete: () => void;
  onMove: () => void;
}) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `file:${file.id}`,
    data: { type: "file", id: file.id, name: file.name },
  });
  const label = toolLabel(file.tool);
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-hover",
        isDragging && "opacity-40"
      )}
    >
      <span
        {...attributes}
        {...listeners}
        className="cursor-grab text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing"
        title="Drag to a folder"
      >
        <GripVertical size={14} />
      </span>
      <button
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left cursor-pointer"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <FileIcon name={file.name} className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-[13px] font-medium text-foreground"
            title={file.name}
          >
            {file.name}
          </p>
          <p className="text-[11.5px] text-muted-foreground">
            {label ? `${label} · ` : ""}
            {fmtSize(file.size)} · {fmtDate(file.createdAt)}
          </p>
        </div>
      </button>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-100 transition-opacity">
        <RowAction title="Move to…" onClick={onMove}>
          <FolderInput size={14} />
        </RowAction>
        <RowAction title="Download" onClick={onDownload} busy={busy}>
          <Download size={14} />
        </RowAction>
        <RowAction title="Rename" onClick={onRename}>
          <Pencil size={14} />
        </RowAction>
        <RowAction title="Share link" onClick={onShare}>
          <Share2 size={14} />
        </RowAction>
        <RowAction title="Delete" tone="danger" onClick={onDelete}>
          <Trash2 size={14} />
        </RowAction>
      </div>
    </div>
  );
}

/* ---------------- Move-to menu (modal list) ---------------- */

function MoveMenu({
  file,
  folders,
  onPick,
  onClose,
}: {
  file: SavedFile;
  folders: { id: string; name: string; depth: number }[];
  onPick: (folderId: string | null) => void;
  onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose} title={`Move “${file.name}”`}>
      <p className="mb-3 text-[12.5px] text-muted-foreground">
        Pick a destination folder.
      </p>
      <div className="max-h-72 overflow-auto">
        <button
          onClick={() => onPick(null)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-hover text-foreground disabled:text-muted-foreground/60 disabled:hover:bg-transparent"
          disabled={file.folderId === null}
        >
          <FolderOpen size={14} className="text-muted-foreground" /> My Files (root)
        </button>
        {folders.map((f) => (
          <button
            key={f.id}
            onClick={() => onPick(f.id)}
            disabled={file.folderId === f.id}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-hover text-foreground disabled:text-muted-foreground/60 disabled:hover:bg-transparent"
            style={{ paddingLeft: 8 + f.depth * 16 }}
          >
            <Folder size={14} className="text-muted-foreground" /> {f.name}
          </button>
        ))}
      </div>
    </Modal>
  );
}

/* ---------------- shared bits ---------------- */

function RowAction({
  children,
  title,
  onClick,
  tone,
  busy,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  tone?: "danger";
  busy?: boolean;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      disabled={busy}
      onClick={onClick}
      className={cn(
        "h-7 w-7 grid place-items-center rounded-md border border-transparent transition-colors cursor-pointer",
        tone === "danger"
          ? "text-danger hover:bg-danger/10"
          : "text-muted-foreground hover:text-foreground hover:bg-hover hover:border-border"
      )}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : children}
    </button>
  );
}

/* ---------------- Full-page single-document preview ---------------- */

function FilePreviewPage({
  file,
  onBack,
  onDownload,
  onShare,
  onRename,
  onDelete,
  onEdit,
  editable,
}: {
  file: SavedFile;
  onBack: () => void;
  onDownload: () => void;
  onShare: () => void;
  onRename: () => void;
  onDelete: () => void;
  onEdit: () => void;
  editable: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let objUrl: string | null = null;
    setUrl(null);
    setErr(null);
    fileObjectUrl(file)
      .then((u) => {
        if (!alive) {
          if (u) URL.revokeObjectURL(u);
          return;
        }
        if (u) {
          objUrl = u;
          setUrl(u);
        } else setErr("This file is no longer available.");
      })
      .catch((e) => alive && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [file.id]);

  const isPdf = file.mime === "application/pdf";
  const isImage = file.mime.startsWith("image/");

  return (
    <div className="animate-fade-up flex h-[calc(100vh-7rem)] flex-col">
      <div className="mb-3 flex items-center gap-3 flex-wrap">
        <button
          className="rounded-md p-2 text-muted-foreground hover:bg-hover hover:text-foreground transition-colors cursor-pointer"
          onClick={onBack}
          aria-label="Back"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1
            className="truncate text-[15px] font-medium text-foreground"
            title={file.name}
          >
            {file.name}
          </h1>
          <p className="text-[11.5px] text-muted-foreground">
            {fmtSize(file.size)} · {fmtDate(file.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {editable && (
            <button className="btn-ghost" onClick={onEdit} title="Open in its editor">
              <ExternalLink size={15} /> Edit
            </button>
          )}
          <button className="btn-ghost" onClick={onRename}>
            <Pencil size={15} /> Rename
          </button>
          <button className="btn-ghost" onClick={onShare}>
            <Share2 size={15} /> Share
          </button>
          <button className="btn-ghost" onClick={onDownload}>
            <Download size={15} /> Download
          </button>
          <button className="btn-ghost text-danger" onClick={onDelete}>
            <Trash2 size={15} /> Delete
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden rounded-xl border border-border bg-muted">
        {err ? (
          <div className="grid h-full place-items-center text-center px-6">
            <div>
              <X size={26} className="mx-auto mb-2 text-danger" />
              <p className="text-sm font-medium text-foreground">
                Could not load a preview
              </p>
              <p className="mt-1 text-xs text-muted-foreground max-w-sm">{err}</p>
              <button className="btn-ghost mt-3" onClick={onDownload}>
                <Download size={15} /> Download instead
              </button>
            </div>
          </div>
        ) : !url ? (
          <div className="grid h-full place-items-center">
            <Loader2 size={22} className="animate-spin text-muted-foreground" />
          </div>
        ) : isImage ? (
          <div className="grid h-full place-items-center overflow-auto p-4">
            <img
              src={url}
              alt={file.name}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        ) : isPdf ? (
          <PdfCanvas file={file} />
        ) : (
          <div className="grid h-full place-items-center text-center px-6">
            <div>
              <FileIcon
                name={file.name}
                className="mx-auto mb-2 h-7 w-7 text-muted-foreground"
              />
              <p className="text-sm font-medium text-foreground">
                Preview not available for this file type
              </p>
              <button className="btn-ghost mt-3" onClick={onDownload}>
                <Download size={15} /> Download
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
