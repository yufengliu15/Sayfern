// Customize (S2-10..S2-13): describe a feature, watch the builder read the docs, write and test it, try the
// sandboxed preview, then turn it on. Versions are kept; any can be rolled back. Full-access code needs a review.
// Owned by the builder feature.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { ExtensionInfo } from "../../../shared/api";
import type { Language } from "../../../shared/records";
import type { BuilderEvent, BuildStep, FeatureInfo, FeatureStatus, FeatureTurn, FeatureVersion } from "../../../shared/stage2";
import { api, errorText } from "../api";
import { FeatureFrame } from "../components/FeatureFrame";
import { notifyFeaturesChanged } from "../components/FeatureNav";
import { FeatureReview } from "../components/FeatureReview";
import { Fern, Icon } from "../components/icons";
import { ModelPicker } from "../components/ModelPicker";
import { Switch } from "../components/ui";
import { useApp } from "../context";
import { cls, fmtAgo } from "../lib/format";
import { settingsRoute, type Navigate } from "../router";
import { BUILDER_IDEAS } from "../lib/samples";
import { CUSTOMIZE_SELECT_KEY } from "./FeatureHost";
import { msg, t } from "../i18n";

export interface CustomizeScreenProps {
  language: Language;
  navigate: Navigate;
}


const STATUS_LABEL: Record<FeatureStatus, string> = {
  building: msg("Building"),
  preview: msg("Preview ready"),
  review: msg("Needs your review"),
  on: msg("On"),
  off: msg("Off"),
  failed: msg("Didn't finish"),
};

type Sheet = { featureId: string; version: number; approve: boolean } | null;

// ---------------------------------------------------------------- event reducer

function applyEvent(list: FeatureInfo[], e: BuilderEvent): FeatureInfo[] {
  if (e.type === "started" || e.type === "done" || (e.type === "error" && e.feature)) {
    const f = e.feature!;
    const i = list.findIndex((x) => x.id === f.id);
    return i >= 0 ? list.map((x) => (x.id === f.id ? f : x)) : [f, ...list];
  }
  if (e.type !== "step" && e.type !== "text") return list;
  return list.map((f) => {
    if (f.id !== e.featureId) return f;
    const turns = f.turns.map((t): FeatureTurn => {
      if (t.buildId !== e.buildId) return t;
      if (e.type === "text") return { ...t, text: t.text + e.delta };
      const i = t.steps.findIndex((s) => s.id === e.step.id);
      const steps = i >= 0 ? t.steps.map((s) => (s.id === e.step.id ? e.step : s)) : [...t.steps, e.step];
      return { ...t, steps };
    });
    return { ...f, turns };
  });
}

/** The version the preview pane shows: the draft when it finished, else the active one, else the newest finished one. */
function previewVersion(f: FeatureInfo): FeatureVersion | undefined {
  const ready = f.versions.filter((v) => v.state === "ready");
  return ready.find((v) => v.n === f.draft) ?? ready.find((v) => v.n === f.active) ?? ready[0];
}

function versionLabel(f: FeatureInfo, v: FeatureVersion): string {
  if (v.state === "building") return "building";
  if (v.state === "failed") return "failed";
  if (v.state === "stopped") return "stopped";
  if (v.n === f.active) return f.enabled ? "on" : "off";
  if (v.n === f.draft) return "draft";
  return "kept";
}

const VERSION_LABEL: Record<string, string> = {
  building: msg("building"),
  failed: msg("didn't finish"),
  stopped: msg("stopped"),
  on: msg("on"),
  off: msg("off"),
  draft: msg("draft"),
  kept: msg("kept"),
};
function versionText(label: string): string {
  return t(VERSION_LABEL[label] ?? label);
}

// ---------------------------------------------------------------- screen

export function CustomizeScreen({ language, navigate }: CustomizeScreenProps) {
  const app = useApp();
  const [features, setFeatures] = useState<FeatureInfo[] | null>(null);
  const [ext, setExt] = useState<ExtensionInfo[] | null>(null);
  const [selected, setSelected] = useState<string | null | undefined>(undefined);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const composer = useRef<BuildComposerHandle>(null);
  const convo = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const list = await api.listFeatures().catch(() => [] as FeatureInfo[]);
    setFeatures(list);
    return list;
  }, []);

  useEffect(() => {
    void refresh().then((list) => {
      let want: string | null = null;
      try {
        want = sessionStorage.getItem(CUSTOMIZE_SELECT_KEY);
        sessionStorage.removeItem(CUSTOMIZE_SELECT_KEY);
      } catch {
        // storage unavailable
      }
      const pick = list.find((f) => f.id === want) ?? list.find((f) => f.status === "building" || f.status === "preview" || f.status === "review") ?? null;
      setSelected(pick?.id ?? null);
    });
    api
      .listExtensions()
      .then(setExt)
      .catch(() => setExt([]));
    return api.onBuilderEvent((e) => setFeatures((cur) => (cur ? applyEvent(cur, e) : cur)));
  }, [refresh]);

  const feature = features?.find((f) => f.id === selected) ?? null;
  const lastTurn = feature?.turns.at(-1);

  // Keep the newest builder output in view.
  useEffect(() => {
    const el = convo.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [selected, lastTurn?.text.length, lastTurn?.steps.length, lastTurn?.status]);

  const upsert = (f: FeatureInfo | null, removedId?: string) => {
    setFeatures((cur) => {
      const list = cur ?? [];
      if (!f) return list.filter((x) => x.id !== removedId);
      return list.some((x) => x.id === f.id) ? list.map((x) => (x.id === f.id ? f : x)) : [f, ...list];
    });
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const build = (text: string) =>
    void run("build", async () => {
      if (!app.model) throw new Error(t("Connect a model in Settings first."));
      const { featureId } = await api.buildFeature({ prompt: text, featureId: feature?.id, language }, app.model);
      setSelected(featureId);
      const f = await api.getFeature(featureId);
      if (f) upsert(f);
    });

  const turnOn = (f: FeatureInfo, version?: number) =>
    void run(`on:${f.id}`, async () => {
      upsert(await api.enableFeature(f.id, version));
      notifyFeaturesChanged();
    });
  const turnOff = (f: FeatureInfo) =>
    void run(`off:${f.id}`, async () => {
      upsert(await api.disableFeature(f.id));
      notifyFeaturesChanged();
    });
  const rollback = (f: FeatureInfo, n: number) =>
    void run(`roll:${n}`, async () => {
      upsert(await api.rollbackFeature(f.id, n));
      notifyFeaturesChanged();
    });
  const discard = (f: FeatureInfo) =>
    void run("discard", async () => {
      const next = await api.discardDraft(f.id);
      upsert(next, f.id);
      if (!next) setSelected(null);
    });
  const remove = (f: FeatureInfo) => {
    if (!window.confirm(t("Delete {name} and all its versions? This can't be undone.", { name: f.name }))) return;
    void run("delete", async () => {
      await api.deleteFeature(f.id);
      upsert(null, f.id);
      setSelected(null);
      notifyFeaturesChanged();
    });
  };
  const needsReview = (f: FeatureInfo, v?: FeatureVersion) => !!v && v.fullAccess && !v.approved;
  const toggle = (f: FeatureInfo, on: boolean) => {
    if (!on) return turnOff(f);
    const v = f.versions.find((x) => x.n === (f.active ?? f.draft));
    if (v && needsReview(f, v)) return setSheet({ featureId: f.id, version: v.n, approve: true });
    turnOn(f, f.active);
  };
  const toggleExt = async (id: string, on: boolean) => {
    setExt((cur) => cur?.map((x) => (x.id === id ? { ...x, enabled: on } : x)) ?? null);
    try {
      setExt(await api.setExtensionEnabled(id, on));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const sheetFeature = sheet ? features?.find((f) => f.id === sheet.featureId) : undefined;
  const sheetVersion = sheetFeature?.versions.find((v) => v.n === sheet?.version);
  const building = feature?.status === "building";

  return (
    <main className="main page cz">
      <div className="page-drag drag" />

      {/* ------------------------------------------------ left: features */}
      <aside className="cz-side" aria-label={t("Your features")}>
        <div className="eyebrow">{t("App-wide")}</div>
        <h1 className="cz-h serif">{t("Customize")}</h1>
        <div className="cz-sec">
          <span className="eyebrow">{t("Your features")}</span>
          <button className={cls("btn btn-s cz-new", selected === null && "on")} onClick={() => { setSelected(null); setError(null); composer.current?.focus(); }}>
            <Icon name="plus" size={14} stroke={2} />
            {t("New")}
          </button>
        </div>
        {features === null ? (
          <div className="cz-skel" />
        ) : features.length === 0 ? (
          <p className="cz-none">{t("Nothing built yet. Describe a feature to start.")}</p>
        ) : (
          <ul className="cz-list">
            {features.map((f) => {
              const canSwitch = f.active != null && f.status !== "building";
              return (
                <li key={f.id} className={cls("cz-f", f.id === selected && "on", f.status === "building" && "live")}>
                  <button className="cz-f-b" onClick={() => { setSelected(f.id); setError(null); }} aria-current={f.id === selected ? "true" : undefined}>
                    <span className="cz-f-n clamp">{f.name}</span>
                    <span className="cz-f-d">
                      <StatusChip status={f.status} />
                      {f.active != null && f.status !== "on" && f.status !== "off" && <span>{f.enabled ? t("v{n} on", { n: f.active }) : t("v{n} off", { n: f.active })}</span>}
                      {(f.status === "on" || f.status === "off") && f.active != null && <span>v{f.active}</span>}
                    </span>
                  </button>
                  {canSwitch && <Switch checked={f.enabled} onChange={(v) => toggle(f, v)} label={t("Turn {name} on or off", { name: f.name })} disabled={busy != null} />}
                </li>
              );
            })}
          </ul>
        )}

        {ext && ext.length > 0 && (
          <>
            <div className="cz-sec">
              <span className="eyebrow">{t("Installed by hand")}</span>
              <button className="linkb" onClick={() => navigate(settingsRoute("extensions"))}>
                {t("Manage")}
              </button>
            </div>
            <ul className="cz-list">
              {ext.map((x) => (
                <li key={x.id} className={cls("cz-f", "ext-row", !x.enabled && "off")}>
                  <div className="cz-f-b static">
                    <span className="cz-f-n clamp">{x.name}</span>
                    <span className="cz-f-d">{x.error ? <span className="cz-err">{t("Couldn't load")}</span> : <span>{t("Extension · v{version}", { version: x.version })}</span>}</span>
                  </div>
                  <Switch checked={x.enabled} onChange={(v) => void toggleExt(x.id, v)} label={t("Turn {name} on or off", { name: x.name })} />
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="cz-foot">{t("Your features live apart from the core app, so updates never overwrite them.")}</p>
      </aside>

      {/* ------------------------------------------------ center: the builder */}
      <section className="cz-main" aria-label={t("Builder")}>
        <div className="cz-convo" ref={convo}>
          {!feature ? (
            <div className="cz-empty">
              <div className="eyebrow">{t("Builder")}</div>
              <h2 className="serif">{t("Describe a feature. Sayfern builds it.")}</h2>
              <p>
                {t(
                  "A drill, a new tab, a tutor habit. Sayfern reads its docs and examples, writes a small extension, tests it and shows you a preview. Nothing changes until you turn it on.",
                )}
              </p>
              <div className="cz-ideas">
                {BUILDER_IDEAS[language].map((i) => (
                  <button key={i} className="chip" onClick={() => composer.current?.setText(t(i))}>
                    {t(i)}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            feature.turns.map((t, i) => (
              <Turn key={t.id} feature={feature} turn={t} last={i === feature.turns.length - 1} />
            ))
          )}
          {feature && lastTurn && (
            <Actions
              feature={feature}
              busy={busy}
              onTurnOn={() => turnOn(feature)}
              onReview={(n) => setSheet({ featureId: feature.id, version: n, approve: true })}
              onChanges={() => composer.current?.focus()}
              onDiscard={() => discard(feature)}
              onRetry={() => build(t("Continue: {prompt}", { prompt: lastTurn.prompt }))}
            />
          )}
          {feature?.loadError && (
            <p className="err">
              <Icon name="alert" size={15} /> {t(feature.loadError)}
            </p>
          )}
          {error && (
            <p className="err" role="alert">
              <Icon name="alert" size={15} /> {t(error)}
            </p>
          )}
        </div>
        <div className="cz-composer">
          <BuildComposer
            ref={composer}
            busy={building}
            disabled={busy === "build"}
            onSend={build}
            onStop={() => feature?.buildId && void api.abortBuild(feature.buildId)}
            placeholder={feature ? t("Ask for changes to {name}…", { name: feature.name }) : t("Describe a feature you want…")}
          />
        </div>
      </section>

      {/* ------------------------------------------------ right: preview and versions */}
      <section className="cz-prev" aria-label={t("Preview")}>
        <Preview feature={feature} language={language} onCode={(n, approve) => feature && setSheet({ featureId: feature.id, version: n, approve })} onRollback={(n) => feature && rollback(feature, n)} onDelete={() => feature && remove(feature)} busy={busy} />
      </section>

      {sheet && sheetFeature && sheetVersion && (
        <FeatureReview
          feature={sheetFeature}
          version={sheetVersion}
          onClose={() => setSheet(null)}
          onApprove={
            sheet.approve && needsReview(sheetFeature, sheetVersion) && sheetVersion.state === "ready"
              ? async () => {
                  await api.approveFeature(sheetFeature.id, sheetVersion.n);
                  upsert(await api.enableFeature(sheetFeature.id, sheetVersion.n));
                  notifyFeaturesChanged();
                  setSheet(null);
                }
              : undefined
          }
        />
      )}
    </main>
  );
}

// ---------------------------------------------------------------- pieces

interface BuildComposerHandle {
  focus(): void;
  setText(text: string): void;
}

/** IME-safe request box: Enter sends, Shift+Enter adds a line. */
const BuildComposer = forwardRef<BuildComposerHandle, { busy: boolean; disabled: boolean; placeholder: string; onSend(text: string): void; onStop(): void }>(
  function BuildComposer({ busy, disabled, placeholder, onSend, onStop }, handle) {
    const [text, setText] = useState("");
    const ta = useRef<HTMLTextAreaElement>(null);
    const composing = useRef(false);
    useImperativeHandle(handle, () => ({
      focus: () => ta.current?.focus(),
      setText: (t) => {
        setText(t);
        requestAnimationFrame(() => {
          ta.current?.focus();
          ta.current?.setSelectionRange(t.length, t.length);
        });
      },
    }));
    useLayoutEffect(() => {
      const el = ta.current;
      if (!el) return;
      el.style.height = "0px";
      el.style.height = `${Math.min(Math.max(el.scrollHeight, 26), 160)}px`;
    }, [text]);
    const canSend = !busy && !disabled && text.trim().length > 0;
    const submit = () => {
      if (!canSend) return;
      onSend(text.trim());
      setText("");
    };
    return (
      <div className={cls("composer cz-comp", busy && "is-busy")}>
        <label htmlFor="cz-prompt" className="sr">
          {t("Describe a feature")}
        </label>
        <textarea
          id="cz-prompt"
          ref={ta}
          rows={1}
          value={text}
          placeholder={busy ? t("Building… you can stop it with the button.") : placeholder}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => (composing.current = false)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229 || composing.current) return;
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="row">
          <ModelPicker />
          {busy ? (
            <button className="send stop" style={{ marginLeft: "auto" }} aria-label={t("Stop the build")} title={t("Stop")} onClick={onStop}>
              <Icon name="stop" size={14} stroke={2.2} />
            </button>
          ) : (
            <button className="send" style={{ marginLeft: "auto" }} aria-label={t("Build it")} title={t("Build it")} onClick={submit} disabled={!canSend}>
              <Icon name="arrow" size={17} stroke={2} />
            </button>
          )}
        </div>
      </div>
    );
  },
);

function StatusChip({ status }: { status: FeatureStatus }) {
  return <span className={cls("cz-st", `cz-st-${status}`)}>{t(STATUS_LABEL[status])}</span>;
}

function StepRow({ step, state }: { step: Pick<BuildStep, "title" | "detail">; state: "done" | "running" | "failed" | "now" | "todo" }) {
  return (
    <li className={cls("bstep", state)}>
      <span className={cls("bdot", state)} aria-hidden="true">
        {state === "done" && <Icon name="check" size={13} stroke={2.6} />}
        {state === "failed" && <Icon name="x" size={13} stroke={2.6} />}
      </span>
      <div>
        <div className="bstep-t">{t(step.title)}</div>
        {step.detail && <div className={cls("bstep-d", /^features\/|·|^\d+ of \d+/.test(step.detail) && "mono")}>{t(step.detail)}</div>}
      </div>
    </li>
  );
}

function Turn({ feature, turn, last }: { feature: FeatureInfo; turn: FeatureTurn; last: boolean }) {
  const v = feature.versions.find((x) => x.n === turn.version);
  const isDraft = feature.draft === turn.version;
  const isOn = feature.enabled && feature.active === turn.version;
  const rows: { key: string; step: Pick<BuildStep, "title" | "detail">; state: "done" | "running" | "failed" | "now" | "todo" }[] = [];
  for (const s of turn.steps) {
    if (s.kind === "preview") {
      if (last && isDraft && turn.status === "done" && !(v?.fullAccess && !v.approved)) rows.push({ key: s.id, step: { title: msg("Try the preview"), detail: s.detail }, state: "now" });
      else rows.push({ key: s.id, step: s, state: "done" });
    } else if (s.kind === "review") {
      if (v?.approved) rows.push({ key: s.id, step: { title: msg("You read and approved the code") }, state: "done" });
      else rows.push({ key: s.id, step: s, state: last && isDraft ? "now" : "todo" });
    } else rows.push({ key: s.id, step: s, state: s.status });
  }
  if (turn.status === "done" && last) rows.push({ key: "on", step: { title: isOn ? msg("Turned on") : msg("Turn it on") }, state: isOn ? "done" : "todo" });
  const live = turn.status === "building";
  return (
    <div className="cz-turn">
      <div className="cz-you">{turn.prompt}</div>
      <div className="cz-bot">
        <div className="cz-bot-h">
          <span className="cz-ava">
            <Fern size={15} />
          </span>
          {t("Builder")}
          <span className="mono muted">v{turn.version}</span>
          {turn.usage && turn.status !== "building" && <span className="cz-when muted">{fmtAgo(turn.at)}</span>}
        </div>
        {turn.text && <div className={cls("cz-text selectable", live && "live")}>{turn.text}</div>}
        {!turn.text && live && turn.steps.length === 0 && <div className="cz-text muted">{t("Starting…")}</div>}
        {rows.length > 0 && (
          <ol className="cz-steps">
            {rows.map((r) => (
              <StepRow key={r.key} step={r.step} state={r.state} />
            ))}
          </ol>
        )}
        {turn.status === "stopped" && <p className="cz-note muted">{t("Stopped. Ask for changes to continue.")}</p>}
      </div>
    </div>
  );
}

function Actions(props: {
  feature: FeatureInfo;
  busy: string | null;
  onTurnOn(): void;
  onReview(n: number): void;
  onChanges(): void;
  onDiscard(): void;
  onRetry(): void;
}) {
  const { feature: f, busy } = props;
  const draft = f.draft != null ? f.versions.find((v) => v.n === f.draft) : undefined;
  if (f.status === "building") return null; // the composer's stop button stops the build
  if (f.status === "preview" || f.status === "review") {
    return (
      <div className="cz-acts">
        {f.status === "review" ? (
          <button className="btn btn-f" onClick={() => draft && props.onReview(draft.n)}>
            {t("Review code")}
          </button>
        ) : (
          <button className="btn btn-f" disabled={busy != null} onClick={props.onTurnOn}>
            {t("Turn it on")}
          </button>
        )}
        <button className="btn" onClick={props.onChanges}>
          {t("Ask for changes")}
        </button>
        <button className="btn cz-discard" disabled={busy != null} onClick={props.onDiscard}>
          {t("Discard")}
        </button>
      </div>
    );
  }
  if (f.status === "failed" && draft) {
    return (
      <div className="cz-acts">
        <button className="btn btn-f" disabled={busy != null} onClick={props.onRetry}>
          <Icon name="refresh" size={15} />
          {t("Try again")}
        </button>
        <button className="btn cz-discard" disabled={busy != null} onClick={props.onDiscard}>
          {t("Discard")}
        </button>
      </div>
    );
  }
  return null;
}

function Preview({
  feature,
  language,
  busy,
  onCode,
  onRollback,
  onDelete,
}: {
  feature: FeatureInfo | null;
  language: Language;
  busy: string | null;
  onCode(n: number, approve: boolean): void;
  onRollback(n: number): void;
  onDelete(): void;
}) {
  const v = feature ? previewVersion(feature) : undefined;
  const surfaces = v?.surfaces ?? [];
  const entries = surfaces.filter((s, i) => surfaces.findIndex((x) => x.entry === s.entry) === i);
  const [pick, setPick] = useState(0);
  const [reload, setReload] = useState(0);
  useEffect(() => setPick(0), [feature?.id, v?.n]);
  const surface = entries[Math.min(pick, entries.length - 1)];
  const wrongLanguage = surface?.languages && !surface.languages.includes(language);

  return (
    <>
      <div className="cz-prev-h">
        <span className="eyebrow">{t("Preview")}</span>
        {feature && v && (
          <span className="mono muted">
            v{v.n} · {versionText(versionLabel(feature, v))}
          </span>
        )}
        {surface && (
          <button className="iconb sm" title={t("Reload the preview")} aria-label={t("Reload the preview")} onClick={() => setReload((r) => r + 1)}>
            <Icon name="refresh" size={15} />
          </button>
        )}
      </div>
      {entries.length > 1 && (
        <div className="seg cz-seg" role="tablist" aria-label={t("Screens")}>
          {entries.map((s, i) => (
            <button key={s.entry} role="tab" aria-selected={i === pick} className={i === pick ? "on" : ""} onClick={() => setPick(i)}>
              {s.title}
            </button>
          ))}
        </div>
      )}
      <div className="cz-frame">
        {!feature ? (
          <div className="cz-frame-msg">
            <Icon name="puzzle" size={22} />
            <p>{t("Your preview shows up here as soon as the builder finishes.")}</p>
          </div>
        ) : !v ? (
          <div className={cls("cz-frame-msg", feature.status === "building" && "live")}>
            <Icon name="puzzle" size={22} />
            <p>{feature.status === "building" ? t("Building. The preview appears when the tests pass.") : t("No finished version to preview.")}</p>
          </div>
        ) : !surface ? (
          <div className="cz-frame-msg">
            <Icon name="tool" size={22} />
            <p>{t("This feature has no screen. It changes the tutor, so try it in a chat once it's on.")}</p>
          </div>
        ) : wrongLanguage ? (
          <div className="cz-frame-msg">
            <Icon name="globe" size={22} />
            <p>{t("This screen is for another language workspace. Switch languages in the sidebar to try it.")}</p>
          </div>
        ) : (
          <FeatureFrame key={`${feature.id}:${v.n}:${reload}`} className="cz-ff" featureId={feature.id} version={v.n} entry={surface.entry} language={language} preview title={t("Preview of {title}", { title: surface.title })} />
        )}
      </div>

      {feature && feature.versions.length > 0 && (
        <div className="cz-vers">
          <div className="cz-vers-h">
            <span className="eyebrow">{t("Versions")}</span>
            <button className="linkb" disabled={busy != null || feature.status === "building"} onClick={onDelete}>
              {t("Delete feature")}
            </button>
          </div>
          <ul>
            {feature.versions.map((x) => {
              const label = versionLabel(feature, x);
              const canUse = x.state === "ready" && x.n !== feature.active && feature.status !== "building";
              const older = feature.active != null && x.n < feature.active;
              return (
                <li key={x.n} className={cls("cz-ver", (label === "on" || label === "off") && "cur")}>
                  <span className="cz-ver-n mono">v{x.n}</span>
                  <div className="cz-ver-t">
                    <span className="clamp">{x.summary ?? x.prompt}</span>
                    <span className="muted">
                      {versionText(label)} · {fmtAgo(x.createdAt)}
                      {x.tests && !x.tests.error ? ` · ${t("tests {passed} of {total}", { passed: x.tests.passed, total: x.tests.total })}` : ""}
                    </span>
                  </div>
                  <div className="cz-ver-a">
                    {x.state !== "building" && x.files.length > 0 && (
                      <button className="btn btn-s" onClick={() => onCode(x.n, x.fullAccess && !x.approved)}>
                        {t("Code")}
                      </button>
                    )}
                    {canUse && x.n !== feature.draft && (
                      <button className="btn btn-s" disabled={busy != null || (x.fullAccess && !x.approved && feature.enabled)} onClick={() => onRollback(x.n)} title={x.fullAccess && !x.approved ? t("Read and approve its code first") : undefined}>
                        {older ? t("Roll back") : t("Use")}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <p className="cz-keep">
        <Icon name="clock" size={15} />
        <span>{t("Every version is kept. You can always roll back.")}</span>
      </p>
    </>
  );
}
