import { Module } from '@nestjs/common';
import { MeController } from './me.controller.js';

/** Exposes GET /me (the current principal, projected from the request's TenantContext). */
@Module({ controllers: [MeController] })
export class MeModule {}
