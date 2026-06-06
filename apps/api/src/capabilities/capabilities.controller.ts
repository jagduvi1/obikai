import { Controller, Get, Inject } from '@nestjs/common';
import type { AppConfig } from '@obikai/config';
import { APP_CONFIG } from '../config.provider.js';
import type { CapabilitiesResponse } from './capabilities.types.js';

/**
 * GET /capabilities — reflects the resolved providers + feature flags so SPAs gate their UI
 * (ADR-0009). Pure projection of AppConfig: no I/O, no auth, safe to cache briefly.
 */
@Controller('capabilities')
export class CapabilitiesController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Get()
  capabilities(): CapabilitiesResponse {
    const { payments, storage, email, auth, ai, sms } = this.config;
    return {
      paymentsProvider: payments.provider,
      storageProvider: storage.provider,
      emailProvider: email.provider,
      authProvider: auth.provider,
      aiProvider: ai.provider,
      aiEnabled: ai.provider !== 'none',
      smsEnabled: sms.provider !== 'disabled',
    };
  }
}
