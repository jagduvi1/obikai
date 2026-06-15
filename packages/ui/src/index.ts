/**
 * @obikai/ui — the Obikai design system as code.
 *
 * Token CSS + the Zen Kaku Gothic New display font live alongside this barrel;
 * link them once per app with `import '@obikai/ui/styles.css'`, then author
 * against the CSS custom properties (never hard-code hex). These components are
 * styled purely with those tokens — dark-only, borders define cards, system-ui
 * body / Zen Kaku display, sentence case, no emoji.
 *
 * "Belt is a presentation type, not an assumption."
 */
export { BrandMark, BrandLockup } from './BrandMark';
export type { BrandMarkProps, BrandLockupProps } from './BrandMark';

export { Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';

export { TextField } from './TextField';
export type { TextFieldProps } from './TextField';

export { Select } from './Select';
export type { SelectProps, SelectOption } from './Select';

export { Badge } from './Badge';
export type { BadgeProps, BadgeTone } from './Badge';

export { StatCard } from './StatCard';
export type { StatCardProps } from './StatCard';

export { Avatar } from './Avatar';
export type { AvatarProps, AvatarBelt } from './Avatar';

export { BeltChip } from './BeltChip';
export type { BeltChipProps, BeltColor } from './BeltChip';

export { CriteriaMeter } from './CriteriaMeter';
export type { CriteriaMeterProps } from './CriteriaMeter';

export { CriterionTag } from './CriterionTag';
export type { CriterionTagProps } from './CriterionTag';

export { ClassCard } from './ClassCard';
export type { ClassCardProps, ClassState, ClassCapacity } from './ClassCard';

export { InvoiceDocument } from './InvoiceDocument';
export type {
  InvoiceDocumentProps,
  InvoiceData,
  InvoiceLineData,
  Money,
} from './InvoiceDocument';
