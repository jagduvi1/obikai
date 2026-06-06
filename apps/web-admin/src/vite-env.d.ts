/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL for the api. Defaults to the dev-proxied `/api`. */
  readonly VITE_API_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
