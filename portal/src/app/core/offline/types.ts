export enum ReportStatus {
  DRAFT = 'DRAFT',
  RECEIVED = 'RECEIVED',
  READY_FOR_CLEANING = 'READY_FOR_CLEANING',
  READY_FOR_INSPECTION = 'READY_FOR_INSPECTION',
  IN_INSPECTION = 'IN_INSPECTION',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  ON_HOLD = 'ON_HOLD',
  CLOSED = 'CLOSED'
}

export interface LocalInspectionReport {
  id: string;
  customerId: string | null;
  poNumber: string;
  status: string;
  templateKey: string;
  templateVersion: number;
  templateHash: string;
  version: number;
  syncState?: 'PENDING' | 'SYNCED' | 'CONFLICT' | 'ERROR';
  updatedAt?: string;
  pendingTransitionToStatus?: string | null;
  availableTransitions?: string | null;
}

export interface LocalSerialNumber {
  id: string;
  inspectionReportId: string;
  value: string;
  version: number;
  inspectionJson?: any;
  syncState?: 'PENDING' | 'SYNCED' | 'CONFLICT' | 'ERROR';
  updatedAt?: string;
}

export interface LocalUser {
  id: string;
  tenantId: string;
  email: string;
  name: string | null;
  role: string;
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
  fromStatus: string;
  toStatus: string;
  userId: string;
  timestamp: string;
  reason?: string | null;
  previousActiveStatus?: string | null;
}

export interface LocalChildReport {
  id: string;
  tenantId: string;
  inspectionReportId: string;
  serialNumberId: string;
  type: 'REWORK' | 'SCRAP' | 'HOLD';
  status: 'DRAFT' | 'IN_INSPECTION' | 'PENDING_APPROVAL' | 'APPROVED' | 'CLOSED';
  notes?: string | null;
  version: number;
  syncState?: 'PENDING' | 'SYNCED' | 'CONFLICT' | 'ERROR';
  updatedAt?: string;
}
