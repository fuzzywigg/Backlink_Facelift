export interface Env {
  CATALOG_CACHE: KVNamespace;
  /** Optional at runtime — `/curate` returns 503 when unset (#8). */
  GEMINI_API_KEY?: string;
  VERSION?: string;
}
