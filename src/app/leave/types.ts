export interface LeaveApprovalRow {
  id: string;
  stepNo: number;
  approverId: string;
  approverName: string;
  decision: string;
  remark: string;
  decidedAt: string;
}

export interface LeaveRow {
  id: string;
  doerId: string;
  doerName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string;
  buddyId: string;
  buddyName: string;
  isEmergency: boolean;
  filedBy: string;
  filedByName: string;
  status: string;
  currentStepNo: number;
  activatedAt: string;
  revertedAt: string;
  createdAt: string;
  approvals: LeaveApprovalRow[];
}

export interface UserOption {
  userId: string;
  fullName: string;
}

export const LEAVE_TYPES = ["Casual", "Sick", "Earned", "Other"] as const;
