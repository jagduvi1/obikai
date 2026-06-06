import { z } from 'zod';

/**
 * The deploy model is TWO orthogonal axes, defined ONCE here and imported everywhere
 * (ADR-0002). Local re-declaration of these literals is lint-forbidden.
 */
export const DEPLOY_MODES = ['self-host', 'hosted'] as const;
export type DeployMode = (typeof DEPLOY_MODES)[number];
export const deployModeSchema = z.enum(DEPLOY_MODES);

export const TENANCIES = ['single', 'multi'] as const;
export type Tenancy = (typeof TENANCIES)[number];
export const tenancySchema = z.enum(TENANCIES);
