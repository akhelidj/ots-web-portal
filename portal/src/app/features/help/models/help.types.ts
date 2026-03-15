import { Type } from '@angular/core';
import { AppRole } from '@portal/core/constants/app.constants';

export const HELP_SECTION_IDS = {
  OVERVIEW: 'OVERVIEW',
  REPORT_LIFECYCLE: 'REPORT_LIFECYCLE',
  INSPECTION_EXECUTION: 'INSPECTION_EXECUTION',
  APPROVALS: 'APPROVALS',
  CHILD_REPORTS: 'CHILD_REPORTS',
  EXPORTS: 'EXPORTS',
  OFFLINE_SYNC: 'OFFLINE_SYNC',
  ADMIN_OPERATIONS: 'ADMIN_OPERATIONS',
  ACCOUNT_SETTINGS: 'ACCOUNT_SETTINGS',
} as const;

export type HelpSectionId =
  (typeof HELP_SECTION_IDS)[keyof typeof HELP_SECTION_IDS];

export interface HelpSectionDefinition {
  id: HelpSectionId;
  component: Type<unknown>;
}

export interface RoleHelpDefinition {
  role: AppRole;
  sections: readonly HelpSectionId[];
}
