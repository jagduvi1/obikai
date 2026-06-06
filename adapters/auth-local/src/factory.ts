/**
 * `ProviderFactory` for the local auth adapter, registered in the `AdapterRegistry` at boot.
 *
 * The local provider takes no non-secret params, so its `paramsSchema` is a trivial validator that
 * yields an empty params object (no runtime zod dependency needed for an empty shape). The
 * `IdentityStore` is NOT part of the resolved adapter config — it is an app-supplied dependency —
 * so the factory is built by closing over the store at composition time.
 */

import type {
  AdapterContext,
  ProviderFactory,
  ResolvedAdapterConfig,
  Validator,
} from '@obikai/adapter-contracts';
import { LocalAuthProvider } from './provider.js';
import type { IdentityStore } from './store.js';

/** The local provider accepts no configurable params. */
export type LocalAuthParams = Record<string, never>;

const emptyParamsSchema: Validator<LocalAuthParams> = {
  parse(): LocalAuthParams {
    return {};
  },
};

/**
 * Build the local-auth `ProviderFactory`, binding the injected `IdentityStore`. Register the
 * result with the `AdapterRegistry`; `create` is then invoked per (kind, tenant) at resolution.
 */
export function createLocalAuthFactory(
  store: IdentityStore,
): ProviderFactory<LocalAuthProvider, LocalAuthParams> {
  return {
    kind: 'auth',
    providerId: 'local',
    paramsSchema: emptyParamsSchema,
    create(_cfg: ResolvedAdapterConfig<LocalAuthParams>, ctx: AdapterContext): LocalAuthProvider {
      return new LocalAuthProvider(store, ctx);
    },
  };
}
