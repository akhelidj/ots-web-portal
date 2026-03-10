export const APP_ROLES = {
  ADMIN: 'ADMIN',
  RECEIVER: 'RECEIVER',
  INSPECTOR: 'INSPECTOR',
  SUPERVISOR: 'SUPERVISOR',
  CUSTOMER: 'CUSTOMER'
} as const;

export type AppRole = typeof APP_ROLES[keyof typeof APP_ROLES];

export const REPORT_STATUSES = {
  DRAFT: 'DRAFT',
  RECEIVED: 'RECEIVED',
  READY_FOR_CLEANING: 'READY_FOR_CLEANING',
  READY_FOR_INSPECTION: 'READY_FOR_INSPECTION',
  IN_INSPECTION: 'IN_INSPECTION',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  ON_HOLD: 'ON_HOLD',
  CLOSED: 'CLOSED'
} as const;

export type ReportStatus = typeof REPORT_STATUSES[keyof typeof REPORT_STATUSES];

export const CHILD_REPORT_STATUSES = {
  DRAFT: 'DRAFT',
  IN_INSPECTION: 'IN_INSPECTION',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  CLOSED: 'CLOSED'
} as const;

export type ChildReportStatus = typeof CHILD_REPORT_STATUSES[keyof typeof CHILD_REPORT_STATUSES];

export const CHILD_REPORT_TYPES = {
  REWORK: 'REWORK',
  SCRAP: 'SCRAP',
  HOLD: 'HOLD'
} as const;

export type ChildReportType = typeof CHILD_REPORT_TYPES[keyof typeof CHILD_REPORT_TYPES];

export const TEMPLATE_KEYS = {
  DRILL_PIPE_REPORT: 'DRILL_PIPE_REPORT'
} as const;

export type TemplateKey = typeof TEMPLATE_KEYS[keyof typeof TEMPLATE_KEYS];

export const ENTITY_TYPES = {
  CUSTOMER: 'CUSTOMER',
  USER: 'USER',
  INSPECTION_REPORT: 'INSPECTION_REPORT',
  SERIAL_NUMBER: 'SERIAL_NUMBER',
  CHILD_REPORT: 'CHILD_REPORT',
} as const;

export type EntityType = typeof ENTITY_TYPES[keyof typeof ENTITY_TYPES];

export const SERIAL_DISPOSITIONS = {
  PASS: 'PASS',
  REWORK: 'REWORK',
  SCRAP: 'SCRAP',
  HOLD: 'HOLD',
} as const;

export type SerialDisposition = typeof SERIAL_DISPOSITIONS[keyof typeof SERIAL_DISPOSITIONS];



