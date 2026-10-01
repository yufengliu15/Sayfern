// Right-hand session context: Anki targets, grammar in play, sources and per-reply activity.
import type { SessionView } from "../../../shared/api";
import type { ChatMessage, Language, PracticeTarget, SourceRef, TargetStatus } from "../../../shared/records";
import { cls, fmtCost, fmtDuration, fmtTime, fmtTokens, STATE_CLASS, STATE_LABEL } from "../lib/format";
import { Icon } from "./icons";

export interface InspectorProps {
  view: SessionView;
  language: Language;
  activeMs: number;
  onOpenGrammar(id: string): void;
  onOpenSource(s: SourceRef): void;
  onClose(): void;
}

const STATUS: Record<TargetStatus, string> = { used: "You used it", asked: "Asked", pending: "Coming up" };

export function Inspector({ view, language, activeMs, onOpenGrammar, onOpenSource, onClose }: InspectorProps) {
  const tutor = view.messages.filter((m) => m.role === "tutor");
  const sources = dedupeSources(tutor.flatMap((m) => m.sources ?? []));
  const u = view.meta.usage;
  const order: Record<TargetStatus, number> = { used: 0, asked: 1, pending: 2 };
  const targets = [...view.targets].sort((a, b) => order[a.status] - order[b.status]);

  return (
    <aside className="insp" aria-label="Session context">
      <div className="insp-top">
        <div className="eyebrow">In this session</div>
        <button className="iconb sm" onClick={onClose} aria-label="Hide inspector" title="Hide inspector (⌘I)">
          <Icon name="panel" size={16} />
        </button>
      </div>

      <section>
        <h3 className="insp-h">Woven into this chat</h3>
        {targets.length === 0 ? (
          <div className="ghost-card">Words from your Anki reviews show up here when Anki is connected.</div>
        ) : (
          <>
            <div className="insp-sub">From this week's Anki reviews</div>
            <ul className="wl">
              {targets.map((t) => (
                <TargetRow key={t.word} t={t} language={language} />
              ))}
            </ul>
          </>
        )}
      </section>

      <section>
        <h3 className="insp-h">Grammar in play</h3>
        {view.grammarInPlay.length === 0 ? (
          <div className="ghost-card">Patterns you use show up here, with how often they land.</div>
        ) : (
          <div className="stack">
            {view.grammarInPlay.map((g) => (
              <button key={g.point.id} className="gcard" onClick={() => onOpenGrammar(g.point.id)}>
                <span className="gcard-top">
                  <span className={cls("gp", language)}>{g.point.pattern}</span>
                  <span className={STATE_CLASS[g.state]}>{STATE_LABEL[g.state]}</span>
                </span>
                <span className="gcard-name">{g.point.name}</span>
                <span className="counts">
                  <span className="ok">{g.counts.correct} correct</span>
                  <span className="bad">{g.counts.incorrect} incorrect</span>
                  {g.counts.uncertain > 0 && <span className="unc">{g.counts.uncertain} unsure</span>}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {sources.length > 0 && (
        <section>
          <h3 className="insp-h">Sources</h3>
          <div className="stack">
            {sources.map((s, i) =>
              s.kind === "library" ? (
                <button key={i} className="srcc" onClick={() => onOpenSource(s)}>
                  <span className="spine" aria-hidden="true" />
                  <span className="srcc-t">
                    <b>{s.title ?? "Library document"}</b>
                    {s.quote && <span className={cls("srcc-q", language)}>{s.quote}</span>}
                    <span className="srcc-l">Open passage · ¶{s.paragraph + 1}</span>
                  </span>
                </button>
              ) : (
                <button key={i} className="srcc" onClick={() => onOpenSource(s)}>
                  <span className="spine alt" aria-hidden="true" />
                  <span className="srcc-t">
                    <b>An earlier session</b>
                    <span className="srcc-l">Open conversation</span>
                  </span>
                </button>
              ),
            )}
          </div>
        </section>
      )}

      {tutor.some((m) => m.usage || m.toolActivity?.length) && (
        <section>
          <h3 className="insp-h">Activity</h3>
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
          <span>{fmtDuration(activeMs)} active · saved</span>
        </div>
        <div className="insp-tot mono" title="Tokens and estimated cost at list price. Subscription sign-ins may bill differently.">
          {fmtTokens(u.input)} in · {fmtTokens(u.output)} out · {fmtCost(u.cost)}
        </div>
      </div>
    </aside>
  );
}

function TargetRow({ t, language }: { t: PracticeTarget; language: Language }) {
  return (
    <li className="it" title={t.meaning}>
      <span className={cls("z", language)}>{t.word}</span>
      <span className="rd mono">{t.reading}</span>
      <span className={cls("ts", `ts-${t.status}`)}>
        {t.status === "used" && <Icon name="check" size={13} stroke={2.4} />}
        {STATUS[t.status]}
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
            {fmtTokens(m.usage.input + m.usage.output)} tok · {fmtCost(m.usage.cost)}
          </span>
        )}
      </div>
      {(m.toolActivity ?? []).map((t, i) => (
        <div key={i} className={cls("act", !t.ok && "bad")}>
          <Icon name={t.ok ? "tool" : "alert"} size={12} />
          {t.summary}
        </div>
      ))}
      {!m.toolActivity?.length && <div className="act quiet">Reply only</div>}
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
