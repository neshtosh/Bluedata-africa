/**
 * The permission registry (ARCHITECTURE.md §10.3). The single source of truth for what can be
 * granted: seeded into ref.permissions on deploy (so roles can only reference real keys),
 * enforced by API guards, and used by frontends to show or hide actions.
 *
 * Product permissions (samakios.*, bluedata.*) are added with their modules in Phase 3/4.
 * Removing a key is a breaking change: migrate role_permissions first.
 */
export const PERMISSIONS = {
  'platform.org.read': { product: null, description: 'View the organisation profile' },
  'platform.org.update': { product: null, description: 'Edit the organisation profile' },
  'platform.branches.read': { product: null, description: 'View branches' },
  'platform.branches.manage': { product: null, description: 'Create and edit branches' },
  'platform.members.read': { product: null, description: 'View members and their roles' },
  'platform.members.invite': { product: null, description: 'Invite people to the organisation' },
  'platform.members.manage': {
    product: null,
    description: 'Change member roles, suspend or remove members',
  },
  'platform.roles.read': { product: null, description: 'View roles and their permissions' },
  'platform.billing.read': { product: null, description: 'View plans and subscriptions' },
  'platform.data_sharing.manage': {
    product: null,
    description: 'Give or withdraw consent to share data with BlueData',
  },
  'platform.audit.read': { product: null, description: 'View the organisation audit log' },

  // --- SamakiOS (Phase 3) ---
  'samakios.catalogue.read': {
    product: 'samakios',
    description: 'View the catalogue of items the organisation trades',
  },
  'samakios.partners.read': {
    product: 'samakios',
    description: 'View suppliers, buyers and transporters',
  },
  'samakios.partners.manage': {
    product: 'samakios',
    description: 'Add, edit and archive suppliers, buyers and transporters',
  },
  'samakios.catalogue.manage': {
    product: 'samakios',
    description: 'Add, edit and archive catalogue items and their unit weights',
  },
} as const satisfies Record<
  string,
  { product: 'samakios' | 'bluedata' | null; description: string }
>;

export type PermissionKey = keyof typeof PERMISSIONS;

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export function isPermissionKey(value: string): value is PermissionKey {
  return Object.hasOwn(PERMISSIONS, value);
}

/**
 * System role templates, created in every new organisation (is_system = true). Their permissions
 * are always read from here at request time — not stored — so adding a permission to a template
 * reaches every existing organisation on deploy. Role-specific templates such as procurement
 * officer or storekeeper arrive with the SamakiOS modules.
 */
export const SYSTEM_ROLES = {
  owner: {
    name: 'Owner',
    description: 'Full control, including data-sharing consent',
    permissions: PERMISSION_KEYS,
  },
  admin: {
    name: 'Administrator',
    description:
      'Manages the organisation, members and settings; cannot change data-sharing consent',
    permissions: PERMISSION_KEYS.filter((key) => key !== 'platform.data_sharing.manage'),
  },
  viewer: {
    name: 'Viewer',
    description: 'Read-only access',
    permissions: PERMISSION_KEYS.filter((key) => key.endsWith('.read')),
  },
} as const satisfies Record<
  string,
  { name: string; description: string; permissions: readonly PermissionKey[] }
>;

export type SystemRoleKey = keyof typeof SYSTEM_ROLES;

export function isSystemRoleKey(value: string): value is SystemRoleKey {
  return Object.hasOwn(SYSTEM_ROLES, value);
}
