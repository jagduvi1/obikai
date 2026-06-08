import { api } from '@obikai/api-client';
import type { WaiverTemplate, WaiverTemplateCreateInput } from '@obikai/domain';

/**
 * Waiver templates API binding (scope §4.10). Templates are versioned; editing the body mints a new
 * version server-side (signatures pin the old one), so the admin never has to manage versions by hand.
 */
export function listWaiverTemplates(opts: { active?: boolean } = {}): Promise<WaiverTemplate[]> {
  const qs = opts.active !== undefined ? `?active=${opts.active}` : '';
  return api.get<WaiverTemplate[]>(`/waivers/templates${qs}`);
}

export function createWaiverTemplate(input: WaiverTemplateCreateInput): Promise<WaiverTemplate> {
  return api.post<WaiverTemplate>('/waivers/templates', input);
}

export function updateWaiverTemplate(
  id: string,
  patch: Partial<WaiverTemplateCreateInput>,
): Promise<WaiverTemplate> {
  return api.patch<WaiverTemplate>(`/waivers/templates/${encodeURIComponent(id)}`, patch);
}
