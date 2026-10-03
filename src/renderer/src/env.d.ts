import type { SayfernApi } from "../../shared/api";

declare global {
  interface Window {
    sayfern: SayfernApi;
  }
  /** Vite's build flags (only DEV is used: dev-only debug controls). */
  interface ImportMeta {
    readonly env: { readonly DEV: boolean };
  }
}

declare module "*.css";
