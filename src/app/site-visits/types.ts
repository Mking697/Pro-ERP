export interface SiteVisitAssignment {
  doerId: string;
  doerName: string;
  fundAmount: number | null;
  fundNotes: string;
}

export interface SiteVisitStepRow {
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

export interface SiteVisitRow {
  id: string;
  serialNo: number;
  displayNo: string;
  customerId: string;
  customerName: string;
  raisedVia: string;
  raisedByName: string;
  siteAddress: string;
  siteLatitude: number | null;
  siteLongitude: number | null;
  attendantName: string;
  attendantPhone: string;
  visitFor: "Installation_Check" | "Quality_Complaint" | "Sales_Demo" | "Other";
  status: "Pending" | "Assigned" | "In_Progress" | "Completed";
  currentCycle: number;
  createdBy: string;
  createdAt: string;
  assignments: SiteVisitAssignment[];
  step: SiteVisitStepRow | null;
}

export const SITE_VISIT_STATUS_LABEL: Record<SiteVisitRow["status"], string> = {
  Pending: "Pending",
  Assigned: "Assigned",
  In_Progress: "In Progress",
  Completed: "Completed",
};

export const VISIT_FOR_LABEL: Record<SiteVisitRow["visitFor"], string> = {
  Installation_Check: "Installation Check",
  Quality_Complaint: "Quality Complaint",
  Sales_Demo: "Sales Demo",
  Other: "Other",
};
