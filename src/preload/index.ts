// Generic bridge: every SayfernApi method invokes `ipc:<method>` with its
// arguments; the on* subscriptions listen on EVENT_CHANNELS.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { API_METHODS, EVENT_CHANNELS, ipcChannel, type SayfernApi } from "../shared/api";

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => void ipcRenderer.removeListener(channel, listener);
}

const invokers = Object.fromEntries(
  API_METHODS.map((m) => {
    const channel = ipcChannel(m);
    return [m, (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)];
  }),
);

const api = {
  ...invokers,
  onChatEvent: (cb) => subscribe(EVENT_CHANNELS.chat, cb),
  onAuthEvent: (cb) => subscribe(EVENT_CHANNELS.authEvent, cb),
  onAuthPrompt: (cb) => subscribe(EVENT_CHANNELS.authPrompt, cb),
  onDictionaryProgress: (cb) => subscribe(EVENT_CHANNELS.dictionaryProgress, cb),
  onBuilderEvent: (cb) => subscribe(EVENT_CHANNELS.builder, cb),
} satisfies Pick<SayfernApi, `on${string}` & keyof SayfernApi> as SayfernApi;

contextBridge.exposeInMainWorld("sayfern", api);
