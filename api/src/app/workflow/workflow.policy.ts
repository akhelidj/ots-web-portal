import {
  InspectionReportStatus,
  ChildReportStatus,
  UserRole,
} from '@prisma/client';

export type allowedTransitionMap = {
  [key in UserRole]?: {
    [key in InspectionReportStatus | ChildReportStatus]?: (
      | InspectionReportStatus
      | ChildReportStatus
    )[];
  };
};

// ----------------------------------------------------------------------
// 1. Authoritative InspectionReport Matrix
// ----------------------------------------------------------------------
// SUPERVISOR shares ADMIN's matrix on a report (intake, force-close and reopen included).
const ADMIN_INSPECTION_TRANSITIONS: Partial<
  Record<InspectionReportStatus, InspectionReportStatus[]>
> = {
    [InspectionReportStatus.DRAFT]: [
      InspectionReportStatus.RECEIVED,
      InspectionReportStatus.ON_HOLD,
      InspectionReportStatus.CLOSED,
    ],
    [InspectionReportStatus.RECEIVED]: [
      InspectionReportStatus.READY_FOR_CLEANING,
      InspectionReportStatus.ON_HOLD,
      InspectionReportStatus.CLOSED,
    ],
    [InspectionReportStatus.READY_FOR_CLEANING]: [
      InspectionReportStatus.READY_FOR_INSPECTION,
      InspectionReportStatus.ON_HOLD,
      InspectionReportStatus.CLOSED,
    ],
    [InspectionReportStatus.READY_FOR_INSPECTION]: [
      InspectionReportStatus.IN_INSPECTION,
      InspectionReportStatus.ON_HOLD,
      InspectionReportStatus.CLOSED,
    ],
    [InspectionReportStatus.IN_INSPECTION]: [
      InspectionReportStatus.PENDING_APPROVAL,
      InspectionReportStatus.ON_HOLD,
      InspectionReportStatus.CLOSED,
    ],
    [InspectionReportStatus.PENDING_APPROVAL]: [
      InspectionReportStatus.IN_INSPECTION,
      InspectionReportStatus.APPROVED,
      InspectionReportStatus.ON_HOLD,
      InspectionReportStatus.CLOSED,
    ],
    [InspectionReportStatus.APPROVED]: [
      InspectionReportStatus.ON_HOLD,
      InspectionReportStatus.CLOSED,
      InspectionReportStatus.IN_INSPECTION,
    ],
    [InspectionReportStatus.ON_HOLD]: [InspectionReportStatus.CLOSED], // Logic for "Previous Active State" handled in service
    [InspectionReportStatus.CLOSED]: [
      InspectionReportStatus.APPROVED,
      InspectionReportStatus.IN_INSPECTION,
    ],
};

export const INSPECTION_REPORT_TRANSITIONS: Record<
  UserRole,
  Partial<Record<InspectionReportStatus, InspectionReportStatus[]>>
> = {
  [UserRole.ADMIN]: ADMIN_INSPECTION_TRANSITIONS,
  [UserRole.RECEIVER]: {
    [InspectionReportStatus.DRAFT]: [InspectionReportStatus.RECEIVED],
    [InspectionReportStatus.RECEIVED]: [
      InspectionReportStatus.READY_FOR_CLEANING,
    ],
    [InspectionReportStatus.READY_FOR_CLEANING]: [
      InspectionReportStatus.READY_FOR_INSPECTION,
    ],
  },
  [UserRole.SUPERVISOR]: ADMIN_INSPECTION_TRANSITIONS,
  [UserRole.INSPECTOR]: {
    [InspectionReportStatus.READY_FOR_INSPECTION]: [
      InspectionReportStatus.IN_INSPECTION,
    ],
    [InspectionReportStatus.IN_INSPECTION]: [
      InspectionReportStatus.PENDING_APPROVAL,
      InspectionReportStatus.ON_HOLD,
    ],
  },
  [UserRole.CUSTOMER]: {},
};

// ----------------------------------------------------------------------
// 2. Authoritative ChildReport Matrix
// ----------------------------------------------------------------------
// SUPERVISOR shares ADMIN's matrix on a child report too.
const ADMIN_CHILD_TRANSITIONS: Partial<
  Record<ChildReportStatus, ChildReportStatus[]>
> = {
  [ChildReportStatus.DRAFT]: [ChildReportStatus.IN_INSPECTION],
  [ChildReportStatus.IN_INSPECTION]: [ChildReportStatus.PENDING_APPROVAL],
  [ChildReportStatus.PENDING_APPROVAL]: [ChildReportStatus.APPROVED],
  [ChildReportStatus.APPROVED]: [
    ChildReportStatus.CLOSED,
    ChildReportStatus.IN_INSPECTION,
  ],
};

export const CHILD_REPORT_TRANSITIONS: Record<
  UserRole,
  Partial<Record<ChildReportStatus, ChildReportStatus[]>>
> = {
  [UserRole.ADMIN]: ADMIN_CHILD_TRANSITIONS,
  [UserRole.SUPERVISOR]: ADMIN_CHILD_TRANSITIONS,
  [UserRole.INSPECTOR]: {
    [ChildReportStatus.DRAFT]: [ChildReportStatus.IN_INSPECTION],
    [ChildReportStatus.IN_INSPECTION]: [ChildReportStatus.PENDING_APPROVAL],
  },
  [UserRole.RECEIVER]: {},
  [UserRole.CUSTOMER]: {},
};

// ----------------------------------------------------------------------
// 3. Reason Requirements
// ----------------------------------------------------------------------
export function isReasonRequiredForInspection(
  fromStatus: InspectionReportStatus,
  toStatus: InspectionReportStatus,
): boolean {
  if (toStatus === InspectionReportStatus.ON_HOLD) return true;
  if (
    fromStatus === InspectionReportStatus.APPROVED &&
    toStatus === InspectionReportStatus.IN_INSPECTION
  )
    return true;
  if (fromStatus === InspectionReportStatus.CLOSED) return true;
  return false;
}

export function isReasonRequiredForChild(
  fromStatus: ChildReportStatus,
  toStatus: ChildReportStatus,
): boolean {
  if (
    fromStatus === ChildReportStatus.APPROVED &&
    toStatus === ChildReportStatus.IN_INSPECTION
  )
    return true;
  // ON_HOLD not in Child enum currently, but if added later:
  // if (toStatus === ChildReportStatus.ON_HOLD) return true;
  return false;
}
