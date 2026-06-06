import { Module } from '@nestjs/common';
import { BillingService } from '@obikai/billing';
import {
  BillingProfileRepository,
  EnrollmentRepository,
  InvoiceCounterRepository,
  InvoiceRepository,
  MemberRepository,
  PaymentAttemptRepository,
  PlanRepository,
  VatRateRepository,
} from '@obikai/db';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';

/**
 * Invoices feature module. InvoicesService serves reads; BillingService (framework-free) drives
 * issuing/payments/dunning, composed from the tenant-scoped @obikai/db repositories. The
 * repositories' guard reads the per-request TenantContext, so no tenant wiring is needed here
 * (ADR-0004).
 */
@Module({
  controllers: [InvoicesController],
  providers: [
    {
      provide: InvoicesService,
      useFactory: () => new InvoicesService(new InvoiceRepository()),
    },
    { provide: BillingProfileRepository, useFactory: () => new BillingProfileRepository() },
    { provide: MemberRepository, useFactory: () => new MemberRepository() },
    {
      provide: BillingService,
      useFactory: () =>
        new BillingService({
          plans: new PlanRepository(),
          vatRates: new VatRateRepository(),
          enrollments: new EnrollmentRepository(),
          invoices: new InvoiceRepository(),
          payments: new PaymentAttemptRepository(),
          counters: new InvoiceCounterRepository(),
        }),
    },
  ],
})
export class InvoicesModule {}
