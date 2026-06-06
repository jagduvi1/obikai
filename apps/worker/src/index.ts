/**
 * @obikai/worker — the background job process (ADR-0001). This barrel re-exports the queue and
 * job-name vocabulary so producers (api) can enqueue against the exact same constants the worker
 * consumes. The runnable entrypoint is `main.ts` (`pnpm --filter @obikai/worker start`).
 */
export * from './queues.js';
