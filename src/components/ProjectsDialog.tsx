import { useCallback, useEffect, useRef, useState } from "react";
import { nextVersionName, type ProjectLocation, type ProjectMeta } from "../lib/projects";
import { localStore, serverAvailable, storeFor } from "../lib/projectStores";

export interface OpenProject {
  id: string;
  name: string;
  location: ProjectLocation;
}

interface Props {
  /** The project currently open, if any. */
  current: OpenProject | null;
  /** Whether there is an image to save. */
  canSave: boolean;
  defaultName: string;
  /** "saveAs" starts with a suggested new version name. */
  mode?: "save" | "saveAs";
  onSave: (name: string, asNew: boolean, location: ProjectLocation) => Promise<void>;
  /** Resolves false if opening was cancelled (e.g. to keep unsaved changes). */
  onOpen: (project: ProjectMeta) => Promise<boolean>;
  /** Called after the open project is renamed or deleted. */
  onCurrentChanged: (project: OpenProject | null) => void;
  onClose: () => void;
}

const TARGET_KEY = "bead-pattern:save-target";
const LOCATION_LABEL: Record<ProjectLocation, string> = { local: "This device", server: "Server" };
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function lastTarget(): ProjectLocation {
  try {
    return localStorage.getItem(TARGET_KEY) === "server" ? "server" : "local";
  } catch {
    return "local";
  }
}

export function ProjectsDialog({ current, canSave, defaultName, mode = "save", onSave, onOpen, onCurrentChanged, onClose }: Props) {
  const [lists, setLists] = useState<{ local: ProjectMeta[] | null; server: ProjectMeta[] | null }>({ local: null, server: null });
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [target, setTargetState] = useState<ProjectLocation>(current?.location ?? lastTarget());
  const [name, setName] = useState(current?.name ?? defaultName);
  const nameTouched = useRef(false);
  const [renaming, setRenaming] = useState<{ id: string; location: ProjectLocation; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setTarget = (t: ProjectLocation) => {
    setTargetState(t);
    try {
      localStorage.setItem(TARGET_KEY, t);
    } catch {}
  };

  // The device list shows straight away; the server is checked alongside.
  const refresh = useCallback(async () => {
    const localP = localStore.list().catch((e: Error) => (setError(e.message), [] as ProjectMeta[]));
    const serverP = serverAvailable().then(async (ok) => {
      setServerOk(ok);
      return ok ? storeFor("server").list().catch((e: Error) => (setError(e.message), [] as ProjectMeta[])) : ([] as ProjectMeta[]);
    });
    const local = await localP;
    setLists((l) => ({ ...l, local }));
    const server = await serverP;
    setLists({ local, server });
    return { local, server };
  }, []);

  useEffect(() => {
    void refresh().then(({ local, server }) => {
      // "Save as…": suggest the next version once we know which names exist.
      if (mode === "saveAs" && current && !nameTouched.current) {
        setName(nextVersionName(current.name, [...local, ...server].map((p) => p.name)));
      }
    });
  }, [refresh, mode, current]);

  // Can't save to the server if it isn't there.
  useEffect(() => {
    if (serverOk === false && target === "server") setTargetState("local");
  }, [serverOk, target]);

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

  const updatesCurrent = !!current && current.location === target && mode !== "saveAs";
  const save = (asNew: boolean) =>
    run(async () => {
      await onSave(name, asNew, target);
      nameTouched.current = false;
      await refresh();
    });

  const rename = () =>
    run(async () => {
      if (!renaming) return;
      await storeFor(renaming.location).rename(renaming.id, renaming.name);
      if (current?.id === renaming.id) onCurrentChanged({ ...current, name: renaming.name.trim() || current.name });
      setRenaming(null);
      await refresh();
    });

  const remove = (p: ProjectMeta) =>
    run(async () => {
      await storeFor(p.location).remove(p.id);
      if (current?.id === p.id) onCurrentChanged(null);
      setConfirmDelete(null);
      await refresh();
    });

  const copy = (p: ProjectMeta, to: ProjectLocation) =>
    run(async () => {
      const image = await storeFor(p.location).loadImage(p.id);
      if (!image) throw new Error("That project's image is missing.");
      await storeFor(to).save({ name: p.name, image, imageName: p.imageName, thumbnail: p.thumbnail, state: p.state });
      await refresh();
    });

  const renderList = (location: ProjectLocation, items: ProjectMeta[] | null) => (
    <section className="project-group" aria-label={location === "local" ? "On this device" : "On the server"}>
      <h4>{location === "local" ? "On this device" : "On the server"}</h4>
      {items === null ? (
        <p className="muted small">Loading…</p>
      ) : items.length === 0 ? (
        <p className="muted small">No saved projects yet.</p>
      ) : (
        <ul>
          {items.map((p) => {
            const key = `${location}:${p.id}`;
            const isCurrent = current?.id === p.id && current.location === location;
            return (
              <li key={key} className={isCurrent ? "active" : ""}>
                <img className="project-thumb" src={p.thumbnail} alt="" />
                <div className="project-info">
                  {renaming?.id === p.id && renaming.location === location ? (
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
                        onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
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
                        {isCurrent && " · open"}
                      </span>
                    </>
                  )}
                </div>
                <div className="project-actions">
                  {confirmDelete === key ? (
                    <>
                      <span className="small">Delete?</span>
                      <button className="btn btn-danger" disabled={busy} onClick={() => void remove(p)}>
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
                      <button className="btn btn-ghost" disabled={busy} onClick={() => setRenaming({ id: p.id, location, name: p.name })}>
                        Rename
                      </button>
                      {location === "local" && serverOk && (
                        <button className="btn btn-ghost" disabled={busy} onClick={() => void copy(p, "server")}>
                          Copy to server
                        </button>
                      )}
                      {location === "server" && (
                        <button className="btn btn-ghost" disabled={busy} onClick={() => void copy(p, "local")}>
                          Copy to device
                        </button>
                      )}
                      <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirmDelete(key)}>
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal projects-modal" role="dialog" aria-modal="true" aria-label="Projects" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{mode === "saveAs" ? "Save as new version" : "Projects"}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <form
          className="project-save"
          onSubmit={(e) => {
            e.preventDefault();
            void save(!updatesCurrent);
          }}
        >
          <label htmlFor="project-name">{current ? (mode === "saveAs" ? "New version name" : "Current project") : "Save this pattern"}</label>
          <div className="row">
            <input
              id="project-name"
              className="input"
              placeholder="Project name"
              value={name}
              onChange={(e) => {
                nameTouched.current = true;
                setName(e.target.value);
              }}
              disabled={!canSave}
            />
          </div>
          <div className="row save-target">
            <span className="small">Save to</span>
            <div className="segmented" role="radiogroup" aria-label="Save to">
              {(["local", "server"] as const).map((loc) => (
                <button
                  key={loc}
                  type="button"
                  role="radio"
                  aria-checked={target === loc}
                  className={target === loc ? "on" : ""}
                  disabled={loc === "server" && !serverOk}
                  onClick={() => setTarget(loc)}
                >
                  {LOCATION_LABEL[loc]}
                </button>
              ))}
            </div>
            {serverOk === false && <span className="muted small">Server storage isn't available here.</span>}
          </div>
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={!canSave || busy}>
              {updatesCurrent ? "Save" : mode === "saveAs" ? "Save as new version" : "Save"}
            </button>
            {updatesCurrent && (
              <button type="button" className="btn btn-ghost" disabled={!canSave || busy} onClick={() => void save(true)}>
                Save as new version
              </button>
            )}
          </div>
          {!canSave && <p className="hint">Add an image first, then save it as a project.</p>}
          <p className="hint">
            {target === "server" ? "Saved on the server: available from any device on your network." : "Saved in this browser only."}
          </p>
        </form>

        <div className="project-list">
          {renderList("local", lists.local)}
          {serverOk && renderList("server", lists.server)}
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
