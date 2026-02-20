export interface LocalInspectionReport {
  id: string;
  status: string;
  customerId: string | null;
  updatedAt: string;
  payload: any;
}

export interface LocalSerialNumber {
  id: string;
  inspectionReportId: string;
  serialNumberValue: string | null;
  payload: any;
}

export type OutboxStatus = 'PENDING' | 'SYNCED' | 'FAILED' | 'CONFLICT';

export interface OutboxItem {
  id: string;
  idempotencyKey: string;
  createdAt: string;
  entityType: string;
  entityId: string;
  operation: string;
  payload: any;
  status: OutboxStatus;
  attemptCount: number;
  lastError: string | null;
}

export interface MetaRecord {
  key: string;
  value: any;
}
