// Fisheries reference vocabulary, seeded in every environment (idempotent).
//
// Species: the main commercial species of Lake Victoria and regional aquaculture, by scientific
// name. Local names are the commonly used ones we are confident of; they MUST be reviewed by
// people who work at the landing sites before any pilot (see PROJECT_STATUS.md), and data
// stewards will extend them.
//
// No container weights are seeded: a "basin" or "tin" has no standard weight, so each
// organisation records its own per catalogue item (ADR-008).

export const SPECIES = [
  {
    scientificName: 'Lates niloticus',
    commonNameEn: 'Nile perch',
    family: 'Latidae',
    habitat: 'freshwater',
    farmed: false,
    names: [
      { language: 'luo', countryCode: 'KE', name: 'mbuta' },
      { language: 'lg', countryCode: 'UG', name: 'mputa' },
      { language: 'sw', countryCode: 'TZ', name: 'sangara' },
    ],
  },
  {
    scientificName: 'Oreochromis niloticus',
    commonNameEn: 'Nile tilapia',
    family: 'Cichlidae',
    habitat: 'freshwater',
    farmed: true,
    names: [
      { language: 'luo', countryCode: 'KE', name: 'ngege' },
      { language: 'lg', countryCode: 'UG', name: 'ngege' },
      { language: 'sw', countryCode: 'TZ', name: 'sato' },
    ],
  },
  {
    scientificName: 'Rastrineobola argentea',
    commonNameEn: 'Silver cyprinid',
    family: 'Cyprinidae',
    habitat: 'freshwater',
    farmed: false,
    names: [
      { language: 'luo', countryCode: 'KE', name: 'omena' },
      { language: 'sw', countryCode: 'KE', name: 'omena' },
      { language: 'lg', countryCode: 'UG', name: 'mukene' },
      { language: 'sw', countryCode: 'TZ', name: 'dagaa' },
    ],
  },
  {
    scientificName: 'Clarias gariepinus',
    commonNameEn: 'African sharptooth catfish',
    family: 'Clariidae',
    habitat: 'freshwater',
    farmed: true,
    names: [{ language: 'sw', countryCode: null, name: 'kambale' }],
  },
  {
    scientificName: 'Protopterus aethiopicus',
    commonNameEn: 'Marbled lungfish',
    family: 'Protopteridae',
    habitat: 'freshwater',
    farmed: false,
    names: [
      { language: 'luo', countryCode: 'KE', name: 'kamongo' },
      { language: 'lg', countryCode: 'UG', name: 'mamba' },
    ],
  },
  {
    scientificName: 'Haplochromis spp.',
    commonNameEn: 'Haplochromine cichlids',
    family: 'Cichlidae',
    habitat: 'freshwater',
    farmed: false,
    names: [
      { language: 'luo', countryCode: 'KE', name: 'fulu' },
      { language: 'lg', countryCode: 'UG', name: 'nkejje' },
      { language: 'sw', countryCode: 'TZ', name: 'furu' },
    ],
  },
] as const;

/** How fish is traded (DATABASE.md §3.3); prices differ sharply between forms. */
export const PRODUCT_FORMS = [
  { code: 'fresh_whole', name: 'Fresh, whole' },
  { code: 'fresh_gutted', name: 'Fresh, gutted' },
  { code: 'fillet_fresh', name: 'Fillet, fresh' },
  { code: 'fillet_frozen', name: 'Fillet, frozen' },
  { code: 'sun_dried', name: 'Sun-dried' },
  { code: 'smoked', name: 'Smoked' },
  { code: 'fried', name: 'Fried' },
  { code: 'salted', name: 'Salted' },
  { code: 'fish_maw', name: 'Fish maw (swim bladder)' },
  { code: 'frames_offcuts', name: 'Frames and off-cuts' },
  { code: 'fish_meal', name: 'Fish meal' },
  { code: 'live_fingerlings', name: 'Live fingerlings' },
] as const;

/** Mass units carry a fixed kg factor; count/container units are weighed per item, per business. */
export const UNITS = [
  { code: 'kg', name: 'Kilogram', dimension: 'mass', kgFactor: '1' },
  { code: 'g', name: 'Gram', dimension: 'mass', kgFactor: '0.001' },
  { code: 't', name: 'Tonne', dimension: 'mass', kgFactor: '1000' },
  { code: 'piece', name: 'Piece', dimension: 'count', kgFactor: null },
  { code: 'basin', name: 'Basin', dimension: 'container', kgFactor: null },
  { code: 'tin', name: 'Tin', dimension: 'container', kgFactor: null },
  { code: 'crate', name: 'Crate', dimension: 'container', kgFactor: null },
  { code: 'bag', name: 'Bag', dimension: 'container', kgFactor: null },
  { code: 'bucket', name: 'Bucket', dimension: 'container', kgFactor: null },
] as const;
