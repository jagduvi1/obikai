import { api } from '@obikai/api-client';
import type { BillingInterval, Currency, Invoice, Money, Plan, PlanType } from '@obikai/domain';

/** Format integer-minor-unit Money in the active locale (e.g. 49900 SEK → "499,00 kr"). */
export function formatMoney(m: Money, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency }).format(
    m.amountMinor / 100,
  );
}

export function listPlans(opts: { active?: boolean } = {}): Promise<Plan[]> {
  const qs = opts.active === undefined ? '' : `?active=${opts.active}`;
  return api.get<Plan[]>(`/plans${qs}`);
}

export interface CreatePlanInput {
  name: string;
  type: PlanType;
  priceMinor: number;
  currency: Currency;
  interval: BillingInterval;
}
export function createPlan(input: CreatePlanInput): Promise<Plan> {
  return api.post<Plan>('/plans', input);
}

/** A member's invoices (staff/owner via invoice:list; the member's own via self-access). */
export function listMemberInvoices(memberId: string): Promise<Invoice[]> {
  return api.get<Invoice[]>(`/invoices?memberId=${encodeURIComponent(memberId)}`);
}

/**
 * Download an invoice PDF. The access token lives in memory (not a cookie), so we fetch the bytes via
 * the authenticated api-client and save the resulting Blob client-side rather than using a raw link.
 */
export async function downloadInvoicePdf(invoiceId: string, filename: string): Promise<void> {
  const blob = await api.getBlob(`/invoices/${encodeURIComponent(invoiceId)}/pdf`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
