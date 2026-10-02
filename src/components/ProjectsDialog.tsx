import { useCallback, useEffect, useState } from "react";
import { deleteProject, listProjects, renameProject, type ProjectMeta } from "../lib/projects";

interface Props {
  /** The project currently open, if any. */
  current: { id: string; name: string } | null;
  /** Whether there is an image to save. */
  canSave: boolean;
  defaultName: string;
  onSave: (name: string, asNew: boolean) => Promise<void>;
  /** Resolves false if opening was cancelled (e.g. to keep unsaved changes). */
  onOpen: (project: ProjectMeta) => Promise<boolean>;
  /** Called after the open project is renamed or deleted. */
  onCurrentChanged: (project: { id: string; name: string } | null) => void;
  onClose: () => void;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function ProjectsDialog({ current, canSave, defaultName, onSave, onOpen, onCurrentChanged, onClose }: Props) {
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [name, setName] = useState(current?.name ?? defaultName);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setProjects(await listProjects());
    } catch (e) {
      setError((e as Error).message);
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !renaming && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, renaming]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const save = (asNew: boolean) => run(async () => {
    await onSave(name, asNew);
    await refresh();
  });

  const rename = () =>
    run(async () => {
      if (!renaming) return;
      await renameProject(renaming.id, renaming.name);
      if (current?.id === renaming.id) onCurrentChanged({ id: renaming.id, name: renaming.name.trim() || current.name });
      setRenaming(null);
      await refresh();
    });

  const remove = (id: string) =>
    run(async () => {
      await deleteProject(id);
      if (current?.id === id) onCurrentChanged(null);
      setConfirmDelete(null);
      await refresh();
    });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal projects-modal" role="dialog" aria-modal="true" aria-label="Projects" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Projects</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <form
          className="project-save"
          onSubmit={(e) => {
            e.preventDefault();
            void save(false);
          }}
        >
          <label htmlFor="project-name">{current ? "Current project" : "Save this pattern"}</label>
          <div className="row">
            <input
              id="project-name"
              className="input"
              placeholder="Project name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canSave}
            />
            <button type="submit" className="btn btn-primary" disabled={!canSave || busy}>
              Save
            </button>
            {current && (
              <button type="button" className="btn btn-ghost" disabled={!canSave || busy} onClick={() => void save(true)}>
                Save as copy
              </button>
            )}
          </div>
          {!canSave && <p className="hint">Add an image first, then save it as a project.</p>}
          <p className="hint">Projects are stored in this browser only.</p>
        </form>

        <div className="project-list">
          {projects === null ? (
            <p className="muted">Loading…</p>
          ) : projects.length === 0 ? (
            <p className="muted">No saved projects yet.</p>
          ) : (
            <ul>
              {projects.map((p) => (
                <li key={p.id} className={current?.id === p.id ? "active" : ""}>
                  <img className="project-thumb" src={p.thumbnail} alt="" />
                  <div className="project-info">
                    {renaming?.id === p.id ? (
                      <form
                        className="row"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void rename();
                        }}
                      >
                        <input
                          className="input"
                          aria-label="New name"
                          value={renaming.name}
                          autoFocus
                          onChange={(e) => setRenaming({ id: p.id, name: e.target.value })}
                          onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
                        />
                        <button type="submit" className="btn btn-primary" disabled={busy}>
                          OK
                        </button>
                      </form>
                    ) : (
                      <>
                        <strong className="project-name">{p.name}</strong>
                        <span className="muted small">
                          {p.state.width} beads wide · {dateFormat.format(p.updatedAt)}
                          {current?.id === p.id && " · open"}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="project-actions">
                    {confirmDelete === p.id ? (
                      <>
                        <span className="small">Delete?</span>
                        <button className="btn btn-danger" disabled={busy} onClick={() => void remove(p.id)}>
                          Delete
                        </button>
                        <button className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>
                          Keep
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="btn btn-primary"
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              if (await onOpen(p)) onClose();
                            })
                          }
                        >
                          Open
                        </button>
                        <button className="btn btn-ghost" disabled={busy} onClick={() => setRenaming({ id: p.id, name: p.name })}>
                          Rename
                        </button>
                        <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirmDelete(p.id)}>
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <div className="modal-foot">
            <span className="error">{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
