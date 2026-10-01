import { useEffect, useState } from "react";
import type { AuthEventPayload, AuthPromptPayload, ProviderInfo } from "../../../shared/types";
import { Fern, Icon } from "./icons";

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
        if (e.type === "auth_url") return { ...cur, url: e.url, log: [...cur.log, e.instructions ?? "Opened your browser to sign in."] };
        if (e.type === "device_code") return { ...cur, log: [...cur.log, `Enter code ${e.userCode} at ${e.verificationUri}`] };
        if (e.type === "prompt_cancelled") return cur.prompt?.promptId === e.promptId ? { ...cur, prompt: undefined } : cur;
        return { ...cur, log: [...cur.log, e.message] };
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
    setLogin({ provider: p, log: ["Starting sign-in…"] });
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
        {providers.map((p) => (
          <div className="card prov" key={p.id}>
            <div className="prov-top">
              <div style={{ flex: 1 }}>
                <div className="nm">{p.name}</div>
                <div className="nt">{p.note}</div>
              </div>
              {p.connected && (
                <span className="badge">
                  <Icon name="check" size={13} stroke={2.4} />
                  {p.connected === "oauth" ? "Signed in" : "API key"}
                </span>
              )}
            </div>

            <div className="prov-actions">
              {p.connected ? (
                <button className="btn btn-s" disabled={busy === p.id} onClick={() => disconnect(p)}>
                  Disconnect
                </button>
              ) : (
                <>
                  {p.oauthLabel && (
                    <button className="btn btn-f btn-s" onClick={() => signIn(p)}>
                      {p.oauthLabel}
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
                      Use an API key
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
                  {p.name} API key
                </label>
                <input
                  id={`key-${p.id}`}
                  className="input"
                  type="password"
                  autoFocus
                  placeholder="Paste your API key"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                />
                <button className="btn btn-p" type="submit" disabled={!key.trim() || busy === p.id}>
                  Save
                </button>
                <button className="btn" type="button" onClick={() => setKeyFor(null)}>
                  Cancel
                </button>
              </form>
            )}
            {error?.id === p.id && (
              <div className="err" style={{ marginTop: 0 }}>
                <Icon name="alert" size={15} />
                <span>{error.msg}</span>
              </div>
            )}
          </div>
        ))}
        <p className="note" style={{ padding: "4px 4px 0" }}>
          Claude Pro/Max sign-in draws on your plan's monthly Agent SDK credit, not your regular chat limits. Sign in with
          ChatGPT uses your ChatGPT plan.
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
        <h1>
          Practise with a tutor that <em>remembers</em>.
        </h1>
        <p style={{ fontSize: 17, lineHeight: 1.55, color: "var(--ink-3)", maxWidth: 440, marginTop: 24 }}>
          Connect the model you already pay for. Sayfern is free; your provider bills you directly.
        </p>
        <div style={{ display: "flex", gap: 24, marginTop: 32, fontSize: 13.5, color: "var(--ink-3)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="lock" size={16} />
            Keys encrypted with your Mac's Keychain
          </span>
        </div>
      </div>

      <div className="connect-right">
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 4 }}>
          <div>
            <div className="eyebrow">Step 1</div>
            <div className="serif" style={{ fontSize: 36 }}>
              Connect a model
            </div>
          </div>
          {anyConnected && onDone && (
            <button className="btn btn-p" onClick={onDone}>
              Start practising <Icon name="arrow" size={16} stroke={2} />
            </button>
          )}
        </div>

        {list}
      </div>

      {login && <AuthModal state={login} onCancel={() => void window.sayfern.cancelLogin()} />}
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
    <div className="overlay" role="dialog" aria-modal="true" aria-label={`Sign in to ${state.provider.name}`}>
      <div className="card modal">
        <h2>Sign in to {state.provider.name}</h2>
        <div className="log">
          {state.log.map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </div>
        {state.url && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button className="linkb" style={{ alignSelf: "flex-start" }} onClick={() => window.sayfern.openExternal(state.url!)}>
              Open the sign-in page again
            </button>
            <div className="url">{state.url}</div>
          </div>
        )}
        {pr && pr.type === "select" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 14 }}>{pr.message}</div>
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
              {pr.message}
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
                Continue
              </button>
            </div>
          </form>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
