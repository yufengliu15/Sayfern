import { useEffect, useState } from "react";
import type { AuthEventPayload, AuthPromptPayload, ProviderInfo, ProviderUsage, UsageWindow } from "../../../shared/types";
import { Fern, Icon } from "./icons";
import { intlLocale, msg, t, tn } from "../i18n";
import { useApp } from "../context";
import { fmtCost, fmtShortDate, fmtTime, fmtTokens } from "../lib/format";

interface Props {
  providers: ProviderInfo[];
  onChanged(): Promise<void>;
  onDone?(): void;
  /** Only the provider list (Settings, onboarding card). */
  compact?: boolean;
}

export function Connect({ providers, onChanged, onDone, compact }: Props) {
  const [keyFor, setKeyFor] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; msg: string } | null>(null);
  const [login, setLogin] = useState<{ provider: ProviderInfo; log: string[]; url?: string; prompt?: AuthPromptPayload } | null>(null);
  const anyConnected = providers.some((p) => p.connected);

  useEffect(() => {
    const offEvent = window.sayfern.onAuthEvent((e: AuthEventPayload) => {
      setLogin((cur) => {
        if (!cur) return cur;
        if (e.type === "auth_url") return { ...cur, url: e.url, log: [...cur.log, e.instructions ? t(e.instructions) : t("Opened your browser to sign in.")] };
        if (e.type === "device_code") return { ...cur, log: [...cur.log, t("Enter code {code} at {url}", { code: e.userCode, url: e.verificationUri })] };
        if (e.type === "prompt_cancelled") return cur.prompt?.promptId === e.promptId ? { ...cur, prompt: undefined } : cur;
        return { ...cur, log: [...cur.log, t(e.message)] };
      });
    });
    const offPrompt = window.sayfern.onAuthPrompt((prompt) => setLogin((cur) => (cur ? { ...cur, prompt } : cur)));
    return () => {
      offEvent();
      offPrompt();
    };
  }, []);

  const saveKey = async (p: ProviderInfo) => {
    if (!key.trim()) return;
    setBusy(p.id);
    setError(null);
    try {
      await window.sayfern.setApiKey(p.id, key);
      setKey("");
      setKeyFor(null);
      await onChanged();
    } catch (e) {
      setError({ id: p.id, msg: String((e as Error).message ?? e) });
    } finally {
      setBusy(null);
    }
  };

  const signIn = async (p: ProviderInfo) => {
    setError(null);
    setLogin({ provider: p, log: [t("Starting sign-in…")] });
    try {
      await window.sayfern.login(p.id);
      setLogin(null);
      await onChanged();
    } catch (e) {
      const msg = String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
      setLogin(null);
      if (!/cancel/i.test(msg)) setError({ id: p.id, msg });
    }
  };

  const disconnect = async (p: ProviderInfo) => {
    setBusy(p.id);
    await window.sayfern.logout(p.id);
    await onChanged();
    setBusy(null);
  };

  const list = (
    <>
        {providers.map((p) =>
          p.local ? (
            <LocalCard key={p.id} provider={p} onChanged={onChanged} />
          ) : (
          <div className="card prov" key={p.id}>
            <div className="prov-top">
              <div style={{ flex: 1 }}>
                <div className="nm">{p.name}</div>
                <div className="nt">{t(p.note)}</div>
              </div>
              {p.connected && (
                <span className="badge">
                  <Icon name="check" size={13} stroke={2.4} />
                  {p.connected === "oauth" ? t("Signed in") : t("API key")}
                </span>
              )}
            </div>

            {p.connected && <UsageLine provider={p} />}

            <div className="prov-actions">
              {p.connected ? (
                <button className="btn btn-s" disabled={busy === p.id} onClick={() => disconnect(p)}>
                  {t("Disconnect")}
                </button>
              ) : (
                <>
                  {p.oauthLabel && (
                    <button className="btn btn-f btn-s" onClick={() => signIn(p)}>
                      {t(p.oauthLabel)}
                    </button>
                  )}
                  {p.canApiKey && keyFor !== p.id && (
                    <button
                      className="btn btn-s"
                      onClick={() => {
                        setKeyFor(p.id);
                        setKey("");
                      }}
                    >
                      <Icon name="key" size={15} />
                      {t("Use an API key")}
                    </button>
                  )}
                </>
              )}
            </div>

            {keyFor === p.id && !p.connected && (
              <form
                className="keyrow"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveKey(p);
                }}
              >
                <label htmlFor={`key-${p.id}`} className="sr">
                  {t("{provider} API key", { provider: p.name })}
                </label>
                <input
                  id={`key-${p.id}`}
                  className="input"
                  type="password"
                  autoFocus
                  placeholder={t("Paste your API key")}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                />
                <button className="btn btn-p" type="submit" disabled={!key.trim() || busy === p.id}>
                  {t("Save")}
                </button>
                <button className="btn" type="button" onClick={() => setKeyFor(null)}>
                  {t("Cancel")}
                </button>
              </form>
            )}
            {error?.id === p.id && (
              <div className="err" style={{ marginTop: 0 }}>
                <Icon name="alert" size={15} />
                <span>{t(error.msg)}</span>
              </div>
            )}
          </div>
          ),
        )}
        <p className="note" style={{ padding: "4px 4px 0" }}>
          {t("Claude Pro/Max sign-in draws on your plan's monthly Agent SDK credit, not your regular chat limits. Sign in with ChatGPT uses your ChatGPT plan.")}
        </p>
    </>
  );

  if (compact) {
    return (
      <div className="connect-list">
        {list}
        {login && <AuthModal state={login} onCancel={() => void window.sayfern.cancelLogin()} />}
      </div>
    );
  }

  return (
    <div className="connect">
      <div className="ghost" style={{ fontSize: 520, left: -60, top: 300 }}>
        说
      </div>
      <div className="ghost ja" style={{ fontSize: 280, left: 380, top: -30, fontFamily: "var(--ja)" }}>
        話
      </div>
      <div className="connect-left drag">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Fern size={34} />
          <span className="serif" style={{ fontSize: 34 }}>
            Sayfern
          </span>
        </div>
        <h1>{t("Practise with a tutor that remembers.")}</h1>
        <p style={{ fontSize: 17, lineHeight: 1.55, color: "var(--ink-3)", maxWidth: 440, marginTop: 24 }}>
          {t("Connect the model you already pay for. Sayfern is free; your provider bills you directly.")}
        </p>
        <div style={{ display: "flex", gap: 24, marginTop: 32, fontSize: 13.5, color: "var(--ink-3)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="lock" size={16} />
            {t("Keys encrypted with your system keychain")}
          </span>
        </div>
      </div>

      <div className="connect-right">
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 4 }}>
          <div>
            <div className="eyebrow">{t("Step 1")}</div>
            <div className="serif" style={{ fontSize: 36 }}>
              {t("Connect a model")}
            </div>
          </div>
          {anyConnected && onDone && (
            <button className="btn btn-p" onClick={onDone}>
              {t("Start practising")} <Icon name="arrow" size={16} stroke={2} />
            </button>
          )}
        </div>

        {list}
      </div>

      {login && <AuthModal state={login} onCancel={() => void window.sayfern.cancelLogin()} />}
    </div>
  );
}

const WINDOW_LABELS: Record<UsageWindow["kind"], string> = {
  session: msg("5-hour limit"),
  weekly: msg("Weekly limit"),
  monthly: msg("Monthly limit"),
};

function fmtReset(at: number) {
  return at - Date.now() < 86_400_000 ? fmtTime(at) : fmtShortDate(at);
}

function fmtMoney(amount: number, currency: string) {
  return new Intl.NumberFormat(intlLocale(), { style: "currency", currency }).format(amount);
}

/** Plan limits, balance or spend on this computer, beside a connected provider. */
function UsageLine({ provider: p }: { provider: ProviderInfo }) {
  const [usage, setUsage] = useState<ProviderUsage | null>(null);

  useEffect(() => {
    let live = true;
    setUsage(null);
    window.sayfern.providerUsage(p.id).then((u) => live && setUsage(u), () => undefined);
    return () => {
      live = false;
    };
  }, [p.id, p.connected]);

  if (!usage) return null;
  const { windows, balance, spent, free, billingUrl, error } = usage;
  const requests = spent && tn(spent.today.requests, "{count} request", "{count} requests");

  return (
    <div className="usage">
      {windows && windows.length > 0 && (
        <div className="usage-wins">
          {windows.map((w) => {
            const left = Math.max(0, Math.round(100 - w.usedPercent));
            return (
              <div className="usage-win" key={w.kind}>
                <span className="usage-k">{t(WINDOW_LABELS[w.kind])}</span>
                <span className={`usage-bar${left <= 10 ? " low" : ""}`} aria-hidden>
                  <i style={{ width: `${left}%` }} />
                </span>
                <span className="usage-v">
                  {t("{percent}% left", { percent: left })}
                  {w.resetsAt ? <span className="muted"> · {t("resets {time}", { time: fmtReset(w.resetsAt) })}</span> : null}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {balance && <div className="usage-row">{t("Balance: {amount}", { amount: fmtMoney(balance.amount, balance.currency) })}</div>}
      {spent &&
        (free ? (
          <div className="usage-row">
            {t("Today on this computer: {usage}", { usage: `${requests} · ${t("{tokens} tokens", { tokens: fmtTokens(spent.today.tokens) })}` })}
          </div>
        ) : (
          <div className="usage-row">
            {t("Spent on this computer: {today} today, {month} in 30 days", { today: fmtCost(spent.today.cost), month: fmtCost(spent.last30Days.cost) })}
          </div>
        ))}
      {error && (
        <div className="usage-row muted" title={error}>
          {t("Could not check the limits right now.")}
        </div>
      )}
      {billingUrl && (
        <button className="linkb" onClick={() => void window.sayfern.openExternal(billingUrl)}>
          {p.connected === "oauth" || free ? t("Usage page") : t("Billing page")}
        </button>
      )}
    </div>
  );
}

function LocalCard({ provider: p, onChanged }: { provider: ProviderInfo; onChanged(): Promise<void> }) {
  const local = p.local!;
  const { models } = useApp();
  const [url, setUrl] = useState(local.baseUrl ?? local.defaultUrl);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const found = models.filter((m) => m.provider === p.id).length;

  const connect = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await window.sayfern.connectLocal(local.engine, url.trim(), key.trim() || undefined);
      setKey("");
      await onChanged();
    } catch (e) {
      setError(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await window.sayfern.disconnectLocal(local.engine);
      setUrl(local.defaultUrl);
      await onChanged();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card prov">
      <div className="prov-top">
        <div style={{ flex: 1 }}>
          <div className="nm">
            {p.name} <span className="muted">· {t("Local model")}</span>
          </div>
          <div className="nt">{t(p.note)}</div>
        </div>
        {p.connected && (
          <span className="badge">
            <Icon name="check" size={13} stroke={2.4} />
            {t("Connected")}
          </span>
        )}
      </div>

      {p.connected ? (
        <>
          <div className="nt">
            {t("Connected to {url}", { url: p.connectedVia ?? url })} · {tn(found, "{count} model found", "{count} models found")}
          </div>
          <div className="prov-actions">
            <button className="btn btn-s" disabled={busy} onClick={() => void disconnect()}>
              {t("Disconnect")}
            </button>
          </div>
        </>
      ) : (
        <form
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            void connect();
          }}
        >
          <label htmlFor={`url-${p.id}`} className="sr">
            {t("Server URL")}
          </label>
          <div className="keyrow">
            <input
              id={`url-${p.id}`}
              className="input"
              type="text"
              spellCheck={false}
              placeholder={local.defaultUrl}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button className="btn btn-p" type="submit" disabled={!url.trim() || busy}>
              {busy ? t("Checking…") : t("Connect")}
            </button>
          </div>
          <label htmlFor={`lkey-${p.id}`} className="sr">
            {t("Server API key (optional)")}
          </label>
          <input
            id={`lkey-${p.id}`}
            className="input"
            type="password"
            placeholder={t("Server API key (optional)")}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            style={{ fontFamily: "var(--mono)", fontSize: 13 }}
          />
        </form>
      )}

      {error && (
        <div className="err" style={{ marginTop: 0 }}>
          <Icon name="alert" size={15} />
          <span>{error}</span>
        </div>
      )}
      <div className="nt">
        {t("The server must run with tool calling on: llama-server --jinja.")}{" "}
        <button className="linkb" onClick={() => void window.sayfern.openExternal(local.docsUrl)}>
          {t("Setup guide")}
        </button>
      </div>
    </div>
  );
}

function AuthModal({
  state,
  onCancel,
}: {
  state: { provider: ProviderInfo; log: string[]; url?: string; prompt?: AuthPromptPayload };
  onCancel(): void;
}) {
  const [value, setValue] = useState("");
  const pr = state.prompt;
  const answer = (v: string | null) => {
    if (!pr) return;
    void window.sayfern.answerAuthPrompt(pr.promptId, v);
    setValue("");
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={t("Sign in to {provider}", { provider: state.provider.name })}>
      <div className="card modal">
        <h2>{t("Sign in to {provider}", { provider: state.provider.name })}</h2>
        <div className="log">
          {state.log.map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </div>
        {state.url && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button className="linkb" style={{ alignSelf: "flex-start" }} onClick={() => window.sayfern.openExternal(state.url!)}>
              {t("Open the sign-in page again")}
            </button>
            <div className="url">{state.url}</div>
          </div>
        )}
        {pr && pr.type === "select" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 14 }}>{t(pr.message)}</div>
            {pr.options.map((o) => (
              <button key={o.id} className="btn" style={{ justifyContent: "flex-start" }} onClick={() => answer(o.id)}>
                {o.label}
                {o.description && <span className="muted"> · {o.description}</span>}
              </button>
            ))}
          </div>
        )}
        {pr && pr.type !== "select" && (
          <form
            style={{ display: "flex", flexDirection: "column", gap: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (value.trim()) answer(value.trim());
            }}
          >
            <label htmlFor="auth-input" style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.45 }}>
              {t(pr.message)}
            </label>
            <div className="keyrow">
              <input
                id="auth-input"
                className="input"
                type={pr.type === "secret" ? "password" : "text"}
                placeholder={pr.placeholder}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
              <button className="btn btn-p" type="submit" disabled={!value.trim()}>
                {t("Continue")}
              </button>
            </div>
          </form>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="btn" onClick={onCancel}>
            {t("Cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
