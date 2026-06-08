/**
 * @obikai/notifications — transactional email (scope §4.8/§5, ADR-0003). A framework-free service
 * that renders subject/text/html from `email`-namespace i18n catalogs and hands the message to an
 * injected `EmailPort`. Lives in a shared package so BOTH the api (request-triggered mail) and the
 * worker (dunning / reminder jobs) can send — the worker cannot import from `apps/api`.
 */
export * from './notifications.service.js';
export { EMAIL_CATALOGS } from './email-catalogs.js';
