export type StaffRole = "admin" | "supervisor" | "agent";

export type CustomerPrincipal = {
  type: "customer";
  id: string;
  externalUid: string;
};

export type StaffPrincipal = {
  type: "staff";
  id: string;
  role: StaffRole;
  team: string;
};

export type AuthPrincipal = CustomerPrincipal | StaffPrincipal;
