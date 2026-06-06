import type { Adapter, AdapterKind } from '@obikai/adapter-contracts';

/**
 * A reusable conformance harness: every real adapter (and every fake) is checked against the SAME
 * suite so the common `Adapter` base behaves identically across the six ports (ADR-0003 — one
 * uniform shape for health checks, startup validation, capability gating).
 *
 * It is framework-light: the caller passes vitest's `describe`/`it` (a `TestRegistrar`) so this
 * package does not force a particular test runner version on its consumers. `vitest` is also a
 * direct dependency, so a suite MAY `import { describe, it } from 'vitest'` and hand them in.
 */

/** Minimal `it`/`test` shape — vitest's `it` and `test` both satisfy this. */
export type TestFn = (name: string, fn: () => void | Promise<void>) => void;

/** Minimal `describe` shape — vitest's `describe` satisfies this. */
export type DescribeFn = (name: string, fn: () => void) => void;

export interface TestRegistrar {
  readonly describe: DescribeFn;
  readonly it: TestFn;
}

export interface AdapterContractOptions<T extends Adapter> {
  /** Construct a FRESH adapter for each assertion so cases never share mutable state. */
  readonly make: () => T;
  /** The `kind` the adapter must report (also used to label the suite). */
  readonly expectedKind: AdapterKind;
  /** Optional expected `providerId` (e.g. 'smtp', 'stub'); skipped when omitted. */
  readonly expectedProviderId?: string;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`adapter-contract: ${message}`);
}

/**
 * Register the common-base conformance cases for an adapter against the given test runner. Port-
 * specific behaviour is asserted by each adapter's own suite; this covers the shared `Adapter`
 * contract every port must honour.
 */
export function runAdapterContract<T extends Adapter>(
  registrar: TestRegistrar,
  options: AdapterContractOptions<T>,
): void {
  const { describe, it } = registrar;
  const { make, expectedKind, expectedProviderId } = options;

  describe(`adapter contract: ${expectedKind}`, () => {
    it('reports the expected kind and a non-empty providerId', () => {
      const adapter = make();
      assert(
        adapter.kind === expectedKind,
        `kind should be "${expectedKind}", got "${adapter.kind}"`,
      );
      assert(adapter.providerId.length > 0, 'providerId must be non-empty');
      if (expectedProviderId !== undefined) {
        assert(
          adapter.providerId === expectedProviderId,
          `providerId should be "${expectedProviderId}", got "${adapter.providerId}"`,
        );
      }
    });

    it('exposes a readable capability set', () => {
      const adapter = make();
      assert(adapter.capabilities instanceof Set, 'capabilities must be a Set');
      for (const cap of adapter.capabilities) {
        assert(
          typeof cap === 'string' && cap.length > 0,
          'each capability must be a non-empty string',
        );
      }
    });

    it('supports the init → health → dispose lifecycle', async () => {
      const adapter = make();
      await adapter.init();
      const status = await adapter.health();
      assert(typeof status.ok === 'boolean', 'health().ok must be a boolean');
      await adapter.dispose();
    });

    it('is idempotent across repeated init/dispose calls', async () => {
      const adapter = make();
      await adapter.init();
      await adapter.init();
      await adapter.dispose();
      await adapter.dispose();
    });
  });
}
