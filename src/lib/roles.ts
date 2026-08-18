export const ROLES = ["Admin", "MD", "Delegator", "IQC", "Employee"] as const;

export type Role = (typeof ROLES)[number];

/** Roles allowed to assign tasks to other users. */
export const DELEGATOR_ROLES: Role[] = ["Admin", "MD", "Delegator"];

/** Roles allowed to perform the IQC quality check on an inward entry. */
export const IQC_ROLES: Role[] = ["Admin", "IQC"];
