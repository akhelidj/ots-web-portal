import {
  AppRole,
  ReportStatus,
  ChildReportStatus,
  ChildReportType,
} from '@portal/core/constants/app.constants';

export interface Attachment {
  id: string;
  filename: string;
  url: string;
  createdAt: string;
}

export interface LocalInspectionReport {
  id: string;
  customerId: string | null;
  poNumber: string;
  reportNumber?: string | null;
  status: ReportStatus;
  templateKey: string;
  templateVersion: number;
  templateHash: string;
  // Phase B3: the template's structured definition, embedded in the
  // GET /inspection-reports payload (null for every report until cutover). Drives
  // the definition-driven inspection form; absent/null → legacy hardcoded schema.
  definitionJson?: unknown | null;
  version: number;
  // Phase D step 3 — the generic, definition-keyed header store (fieldKey -> value)
  // is the sole header-field carrier. The generic header edit writes header-scope
  // values here as one map; the effective header view reads them directly. The
  // legacy named columns were retired with their backend columns.
  headerData?: Record<string, unknown> | null;
  attachments?: Attachment[];
  syncState?: 'PENDING' | 'SYNCED' | 'CONFLICT' | 'ERROR';
  updatedAt?: string;
  pendingTransitionToStatus?: ReportStatus | null;
  availableTransitions?: string | null;
}

export type SerialApprovalStatus =
  | 'NOT_INSPECTED'
  | 'INSPECTED_DRAFT'
  | 'SUBMITTED_FOR_APPROVAL'
  | 'APPROVED';

export interface LocalSerialNumber {
  id: string;
  inspectionReportId: string;
  value: string;
  version: number;
  inspectionJson?: Record<string, unknown>;
  approvalStatus?: SerialApprovalStatus;
  syncState?: 'PENDING' | 'SYNCED' | 'CONFLICT' | 'ERROR';
  updatedAt?: string;
}

export interface LocalInspectionApprovalBatch {
  id: string;
  tenantId: string;
  inspectionReportId: string;
  childReportId?: string | null;
  submittedByUserId: string;
  submittedAt: string;
  reviewedByUserId?: string | null;
  reviewedAt?: string | null;
  status: 'SUBMITTED' | 'APPROVED' | 'RETURNED';
  notes?: string | null;
  version: number;
  syncState?: 'PENDING' | 'SYNCED' | 'CONFLICT' | 'ERROR';
}

export interface LocalBatchSerialNumber {
  id: string;
  inspectionApprovalBatchId: string;
  serialNumberId: string;
  status?: 'PENDING' | 'APPROVED' | 'RETURNED';
}

export interface LocalUser {
  id: string;
  tenantId: string;
  email: string;
  name: string | null;
  role: AppRole;
  isActive: boolean;
  mustChangePassword: boolean;
  updatedAt: string;
  customerId?: string | null;
  syncState?: 'CLEAN' | 'PENDING_CREATE' | 'PENDING_UPDATE';
}

export interface LocalCustomer {
  id: string;
  name: string;
  code?: string | null;
  email?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  country?: string | null;
  isActive: boolean;
  version: number;
  syncState?: 'PENDING' | 'SYNCED' | 'CONFLICT' | 'ERROR';
  updatedAt?: string;
  deactivatedAt?: string | null;
  deactivationReason?: string | null;
}

export type OutboxStatus = 'PENDING' | 'SYNCED' | 'FAILED' | 'CONFLICT';

export interface OutboxItem {
  id: string;
  idempotencyKey: string;
  createdAt: string;
  entityType: string;
  entityId: string;
  operation: string;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attemptCount: number;
  lastError: string | null;
}

export interface MetaRecord {
  key: string;
  value: unknown;
}

export interface LocalTransitionLog {
  id: string;
  inspectionReportId: string;
  fromStatus: ReportStatus;
  toStatus: ReportStatus;
  userId: string;
  timestamp: string;
  reason?: string | null;
  previousActiveStatus?: ReportStatus | null;
}

export interface LocalChildReport {
  id: string;
  tenantId: string;
  inspectionReportId: string;
  attachments?: Attachment[];
  attachmentCount?: number;
  serialNumbers: Array<{
    id: string;
    serial: string;
    inspectionData?: Record<string, unknown>;
    disposition?: string;
    approvalStatus?: SerialApprovalStatus;
  }>;
  reportNumber?: string | null;
  type: ChildReportType;
  status: ChildReportStatus;
  notes?: string | null;
  version: number;
  syncState?: 'PENDING' | 'SYNCED' | 'CONFLICT' | 'ERROR';
  updatedAt?: string;
}
