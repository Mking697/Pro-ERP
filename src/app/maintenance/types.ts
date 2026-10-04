export type MaintenanceKind =
  | "Breakdown"
  | "Generator_Repair"
  | "Servicing"
  | "Wiring"
  | "Light_Change"
  | "Other";

export type MaintenanceStatus = "Open" | "Fixed_By_Maintenance" | "Resolved" | "Cancelled";

export interface MaintenanceRequestRow {
  id: string;
  kind: MaintenanceKind;
  productionLineRunId: string;
  productionLineTemplateName: string;
  description: string;
  status: MaintenanceStatus;
  reportedBy: string;
  reportedAt: string;
  assignedTo: string;
  fixedBy: string;
  fixedAt: string;
  fixedRemark: string;
  confirmedBy: string;
  confirmedAt: string;
  confirmedRemark: string;
  pausedTatDeadline: string;
  workingMinutesLost: number | null;
  createdAt: string;
}

export interface MaintenanceActivityRow {
  id: string;
  requestId: string;
  kind: string;
  message: string;
  actorId: string;
  createdAt: string;
}

/** Client-side mirror of /api/fms/my-steps' FmsRunRecord — only the fields the
 * breakdown picker actually needs. */
export interface MyFmsStepOption {
  Run_ID: string;
  Template_Name: string;
  Step_Name: string;
  Status: string;
}
