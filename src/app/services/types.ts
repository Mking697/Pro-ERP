export interface ServiceJobAssignment {
  doerId: string;
  doerName: string;
  fundAmount: number | null;
  fundNotes: string;
}

export interface ServiceStepRow {
  sitePhotoUrl: string;
  siteVideoUrl: string;
  latitude: number | null;
  longitude: number | null;
  step1At: string;
  evidenceUrl: string;
  notes: string;
  chartUrl: string;
  step2At: string;
  expenseAmount: number | null;
  expenseNotes: string;
  billUrls: string[];
  step3At: string;
}

export interface ServiceJobRow {
  id: string;
  customerId: string;
  customerName: string;
  productDetails: string;
  brand: string;
  siteAddress: string;
  attendantName: string;
  attendantPhone: string;
  status: "Pending" | "Assigned" | "In_Progress" | "Completed";
  currentCycle: number;
  createdBy: string;
  createdAt: string;
  assignments: ServiceJobAssignment[];
  step: ServiceStepRow | null;
}

export const SERVICE_STATUS_LABEL: Record<ServiceJobRow["status"], string> = {
  Pending: "Pending",
  Assigned: "Assigned",
  In_Progress: "In Progress",
  Completed: "Completed",
};
