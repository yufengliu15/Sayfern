import type { SayfernApi } from "../../shared/api";

declare global {
  interface Window {
    sayfern: SayfernApi;
  }
}

declare module "*.css";
