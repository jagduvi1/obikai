/**
 * @obikai/billing — framework-free orchestration of the billing lifecycle (ADR-0013): issuing,
 * recurring billing-run, payment recording, and the dunning ladder. Depends only on
 * `@obikai/domain` (pure money/VAT/period math) and `@obikai/authz` (RBAC). The persistence is
 * abstracted behind the `Billing*Store` structural interfaces, satisfied by `@obikai/db`
 * repositories — so the SAME service drives the api (HTTP) and the worker (jobs).
 */
export {
  BillingService,
  BillingError,
  ForbiddenError,
  NotFoundError,
  DUNNING_SUSPEND_STAGE,
  type BillingStores,
  type BillingPlanStore,
  type BillingVatRateStore,
  type BillingEnrollmentStore,
  type BillingInvoiceStore,
  type BillingPaymentStore,
  type BillingCounterStore,
  type PaymentResult,
} from './billing.service.js';
