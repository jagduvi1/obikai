/**
 * EU/EEA data-residency allow-list (GDPR Arts. 44–49). For the HOSTED managed service, member personal
 * data must stay in the EU/EEA, so the object-storage region is constrained to this set unless the
 * operator explicitly opts out via the audited `ALLOW_NON_EU_RESIDENCY` escape hatch (env.ts).
 *
 * These are the AWS EU/EEA regions. UK (`eu-west-2`) and Switzerland (`eu-central-2`) are deliberately
 * EXCLUDED: they rely on adequacy decisions rather than being in the EEA, so they require the explicit
 * opt-out. Self-host is not constrained here — the operator controls where their own MinIO/disk lives,
 * and S3-compatible region strings (e.g. MinIO's `us-east-1`) don't denote physical location.
 */
export const EU_DATA_RESIDENCY_REGIONS = [
  'eu-north-1', // Stockholm, SE
  'eu-west-1', // Dublin, IE
  'eu-west-3', // Paris, FR
  'eu-central-1', // Frankfurt, DE
  'eu-south-1', // Milan, IT
  'eu-south-2', // Aragón, ES
] as const;

export type EuDataResidencyRegion = (typeof EU_DATA_RESIDENCY_REGIONS)[number];

/** True if `region` is an EU/EEA region acceptable for hosted data residency. */
export function isEuDataResidencyRegion(region: string): boolean {
  return (EU_DATA_RESIDENCY_REGIONS as readonly string[]).includes(region);
}
