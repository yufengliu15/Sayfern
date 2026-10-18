// Right-hand session context: Anki targets, grammar in play, sources and per-reply activity.
import type { SessionView } from "../../../shared/api";
import type { ChatMessage, Language, PracticeTarget, SourceRef, TargetStatus } from "../../../shared/records";
import { cls, fmtCost, fmtDuration, fmtTime, fmtTokens, STATE_CLASS, STATE_LABEL, fontOf, activityText } from "../lib/format";
import { Icon } from "./icons";
import { MOD } from "../lib/platform";
import { msg, t } from "../i18n";

export interface InspectorProps {
  view: SessionView;
  language: Language;
  activeMs: number;
  onOpenGrammar(id: string): void;
  onOpenSource(s: SourceRef): void;
  onClose(): void;
}

const STATUS: Record<TargetStatus, string> = { used: msg("You used it"), asked: msg("Asked"), pending: msg("Coming up") };

export function Inspector({ view, language, activeMs, onOpenGrammar, onOpenSource, onClose }: InspectorProps) {
  const tutor = view.messages.filter((m) => m.role === "tutor");
  const sources = dedupeSources(tutor.flatMap((m) => m.sources ?? []));
  const u = view.meta.usage;
  const order: Record<TargetStatus, number> = { used: 0, asked: 1, pending: 2 };
  const targets = [...view.targets].sort((a, b) => order[a.status] - order[b.status]);

  return (
    <aside className="insp" aria-label={t("Session context")}>
      <div className="insp-top">
        <div className="eyebrow">{t("In this session")}</div>
        <button className="iconb sm" onClick={onClose} aria-label={t("Hide inspector")} title={t("Hide inspector ({shortcut})", { shortcut: `${MOD}I` })}>
          <Icon name="panel" size={16} />
        </button>
      </div>

      <section>
        <h3 className="insp-h">{t("Woven into this chat")}</h3>
        {targets.length === 0 ? (
          <div className="ghost-card">{t("Words from your Anki reviews show up here when Anki is connected.")}</div>
        ) : (
          <>
            <div className="insp-sub">{t("From this week's Anki reviews")}</div>
            <ul className="wl">
              {targets.map((target) => (
                <TargetRow key={target.word} target={target} language={language} />
              ))}
            </ul>
          </>
        )}
      </section>

      <section>
        <h3 className="insp-h">{t("Grammar in play")}</h3>
        {view.grammarInPlay.length === 0 ? (
          <div className="ghost-card">{t("Patterns you use show up here, with how often they land.")}</div>
        ) : (
          <div className="stack">
            {view.grammarInPlay.map((g) => (
              <button key={g.point.id} className="gcard" onClick={() => onOpenGrammar(g.point.id)}>
                <span className="gcard-top">
                  <span className={cls("gp", fontOf(language))}>{g.point.pattern}</span>
                  <span className={STATE_CLASS[g.state]}>{t(STATE_LABEL[g.state])}</span>
                </span>
                <span className="gcard-name">{g.point.name}</span>
                <span className="counts">
                  <span className="ok">{t("{n} correct", { n: g.counts.correct })}</span>
                  <span className="bad">{t("{n} incorrect", { n: g.counts.incorrect })}</span>
                  {g.counts.uncertain > 0 && <span className="unc">{t("{n} unsure", { n: g.counts.uncertain })}</span>}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {sources.length > 0 && (
        <section>
          <h3 className="insp-h">{t("Sources")}</h3>
          <div className="stack">
            {sources.map((s, i) =>
              s.kind === "library" ? (
                <button key={i} className="srcc" onClick={() => onOpenSource(s)}>
                  <span className="spine" aria-hidden="true" />
                  <span className="srcc-t">
                    <b>{s.title ?? t("Library document")}</b>
                    {s.quote && <span className={cls("srcc-q", fontOf(language))}>{s.quote}</span>}
                    <span className="srcc-l">{t("Open passage · ¶{n}", { n: s.paragraph + 1 })}</span>
                  </span>
                </button>
              ) : (
                <button key={i} className="srcc" onClick={() => onOpenSource(s)}>
                  <span className="spine alt" aria-hidden="true" />
                  <span className="srcc-t">
                    <b>{t("An earlier session")}</b>
                    <span className="srcc-l">{t("Open conversation")}</span>
                  </span>
                </button>
              ),
            )}
          </div>
        </section>
      )}

      {tutor.some((m) => m.usage || m.toolActivity?.length) && (
        <section>
          <h3 className="insp-h">{t("Activity")}</h3>
          <ol className="acts">
            {tutor
              .slice(-6)
              .reverse()
              .map((m) => (
                <ActivityRow key={m.id} m={m} />
              ))}
          </ol>
        </section>
      )}

      <div className="insp-foot">
        <div className="insp-tot">
          <Icon name="clock" size={15} />
          <span>{t("{duration} active · saved", { duration: fmtDuration(activeMs) })}</span>
        </div>
        <div className="insp-tot mono" title={t("Tokens and estimated cost at list price. Subscription sign-ins may bill differently.")}>
          {t("{input} in · {output} out · {cost}", { input: fmtTokens(u.input), output: fmtTokens(u.output), cost: fmtCost(u.cost) })}
        </div>
      </div>
    </aside>
  );
}

function TargetRow({ target, language }: { target: PracticeTarget; language: Language }) {
  return (
    <li className="it" title={target.meaning}>
      <span className={cls("z", fontOf(language))}>{target.word}</span>
      <span className="rd mono">{target.reading}</span>
      <span className={cls("ts", `ts-${target.status}`)}>
        {target.status === "used" && <Icon name="check" size={13} stroke={2.4} />}
        {t(STATUS[target.status])}
      </span>
    </li>
  );
}

function ActivityRow({ m }: { m: ChatMessage }) {
  return (
    <li>
      <div className="acts-h">
        <span>{fmtTime(m.at)}</span>
        {m.usage && (
          <span className="mono">
            {t("{tokens} tok · {cost}", { tokens: fmtTokens(m.usage.input + m.usage.output), cost: fmtCost(m.usage.cost) })}
          </span>
        )}
      </div>
      {(m.toolActivity ?? []).map((act, i) => (
        <div key={i} className={cls("act", !act.ok && "bad")}>
          <Icon name={act.ok ? "tool" : "alert"} size={12} />
          {activityText(act.summary)}
        </div>
      ))}
      {!m.toolActivity?.length && <div className="act quiet">{t("Reply only")}</div>}
    </li>
  );
}

function dedupeSources(list: SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  return list.filter((s) => {
    const k = s.kind === "library" ? `l:${s.docId}:${s.paragraph}` : `s:${s.sessionId}:${s.messageId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
