/**
 * The validated AppConfig is loaded ONCE at boot (main.ts) and shared with the Nest container as
 * a value provider under this token. Modules inject it via `@Inject(APP_CONFIG)` rather than
 * reading process.env anywhere (ADR-0009: env is read only by @obikai/config).
 */
import type { AppConfig } from '@obikai/config';

/** DI token for the singleton AppConfig value provider. */
export const APP_CONFIG = 'APP_CONFIG';

/** Convenience alias so injected fields read naturally. */
export type InjectedAppConfig = AppConfig;
