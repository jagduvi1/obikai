/**
 * i18n H4 (ADR-0029): rank content fields became LocalizedString (`{ <locale>: string }`):
 *   - disciplines.name / disciplines.description
 *   - curriculumitems.label / curriculumitems.description
 *
 * Wrap any existing plain-string value as `{ en: value }` (English is the source locale). Forward-only
 * and idempotent: only `$type: 'string'` values are touched, so nulls stay null and already-migrated
 * objects are left alone. Safe to run on every upgrade.
 */
const TARGETS = [
  { collection: 'disciplines', fields: ['name', 'description'] },
  { collection: 'curriculumitems', fields: ['label', 'description'] },
];

module.exports = {
  async up(db) {
    for (const { collection, fields } of TARGETS) {
      const col = db.collection(collection);
      for (const field of fields) {
        const cursor = col.find({ [field]: { $type: 'string' } });
        for await (const doc of cursor) {
          await col.updateOne({ _id: doc._id }, { $set: { [field]: { en: doc[field] } } });
        }
      }
    }
  },

  async down(db) {
    for (const { collection, fields } of TARGETS) {
      const col = db.collection(collection);
      for (const field of fields) {
        const cursor = col.find({ [`${field}.en`]: { $exists: true } });
        for await (const doc of cursor) {
          await col.updateOne({ _id: doc._id }, { $set: { [field]: doc[field].en } });
        }
      }
    }
  },
};
