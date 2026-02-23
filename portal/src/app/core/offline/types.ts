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
}

export interface LocalSerialNumber {
  id: string;
  inspectionReportId: string;
  value: string;
  version: number;
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
