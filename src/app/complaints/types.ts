export interface ComplaintAssignment {
  doerId: string;
  doerName: string;
  fundAmount: number | null;
  fundNotes: string;
}

export interface ComplaintStepRow {
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

export interface ComplaintRow {
  id: string;
  complaintNo: number;
  displayNo: string;
  customerId: string;
  customerName: string;
  jobReference: string;
  warrantyStatus: "In_Warranty" | "Out_Of_Warranty";
  issueDescription: string;
  siteAddress: string;
  attendantName: string;
  attendantPhone: string;
  attachmentUrl: string;
  mediaUrls: string[];
  status: "Pending" | "Assigned" | "In_Progress" | "Completed";
  currentCycle: number;
  createdBy: string;
  createdAt: string;
  assignments: ComplaintAssignment[];
  step: ComplaintStepRow | null;
}

export const COMPLAINT_STATUS_LABEL: Record<ComplaintRow["status"], string> = {
  Pending: "Pending",
  Assigned: "Assigned",
  In_Progress: "In Progress",
  Completed: "Completed",
};
