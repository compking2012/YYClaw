/** Shared palette for office roles (matches `useOfficeStore` roster colors). */
export const OFFICE_ROLE_COLORS = [
  '#667eea',
  '#764ba2',
  '#4facfe',
  '#43e97b',
  '#fa709a',
  '#fee140',
  '#f5576c',
  '#38f9d7',
] as const;

export function officeRoleColorAt(index: number): string {
  return OFFICE_ROLE_COLORS[((index % OFFICE_ROLE_COLORS.length) + OFFICE_ROLE_COLORS.length) % OFFICE_ROLE_COLORS.length]!;
}

export function officeRoleColorForId(roleId: string | undefined, roles: { id: string }[]): string {
  if (!roleId) return OFFICE_ROLE_COLORS[0]!;
  const idx = roles.findIndex((r) => r.id === roleId);
  return officeRoleColorAt(idx >= 0 ? idx : roleId.length);
}

export function officeRoleBubbleStyle(roleId: string | undefined, roles: { id: string }[]): {
  backgroundColor: string;
  borderColor: string;
} {
  const hex = officeRoleColorForId(roleId, roles);
  return {
    backgroundColor: `${hex}1a`,
    borderColor: `${hex}55`,
  };
}
