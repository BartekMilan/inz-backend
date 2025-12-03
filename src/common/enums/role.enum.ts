export enum Role {
  ADMIN = 'admin',
  REGISTRAR = 'registrar',
}

export const RoleLabels: Record<Role, string> = {
  [Role.ADMIN]: 'Administrator',
  [Role.REGISTRAR]: 'Rejestrator',
};
