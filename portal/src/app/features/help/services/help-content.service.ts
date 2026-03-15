import { Injectable } from '@angular/core';
import { APP_ROLES, AppRole } from '@portal/core/constants/app.constants';
import {
  HELP_SECTION_IDS,
  HelpSectionDefinition,
  HelpSectionId,
  RoleHelpDefinition,
} from '@portal/features/help/models/help.types';
import { HelpOverviewSectionComponent } from '@portal/features/help/components/sections/help-overview-section.component';
import { HelpReportLifecycleSectionComponent } from '@portal/features/help/components/sections/help-report-lifecycle-section.component';
import { HelpInspectionExecutionSectionComponent } from '@portal/features/help/components/sections/help-inspection-execution-section.component';
import { HelpApprovalsSectionComponent } from '@portal/features/help/components/sections/help-approvals-section.component';
import { HelpChildReportsSectionComponent } from '@portal/features/help/components/sections/help-child-reports-section.component';
import { HelpExportsSectionComponent } from '@portal/features/help/components/sections/help-exports-section.component';
import { HelpOfflineSyncSectionComponent } from '@portal/features/help/components/sections/help-offline-sync-section.component';
import { HelpAdminOperationsSectionComponent } from '@portal/features/help/components/sections/help-admin-operations-section.component';
import { HelpAccountSettingsSectionComponent } from '@portal/features/help/components/sections/help-account-settings-section.component';

const SECTION_REGISTRY: Readonly<Record<HelpSectionId, HelpSectionDefinition>> =
  {
    [HELP_SECTION_IDS.OVERVIEW]: {
      id: HELP_SECTION_IDS.OVERVIEW,
      component: HelpOverviewSectionComponent,
    },
    [HELP_SECTION_IDS.REPORT_LIFECYCLE]: {
      id: HELP_SECTION_IDS.REPORT_LIFECYCLE,
      component: HelpReportLifecycleSectionComponent,
    },
    [HELP_SECTION_IDS.INSPECTION_EXECUTION]: {
      id: HELP_SECTION_IDS.INSPECTION_EXECUTION,
      component: HelpInspectionExecutionSectionComponent,
    },
    [HELP_SECTION_IDS.APPROVALS]: {
      id: HELP_SECTION_IDS.APPROVALS,
      component: HelpApprovalsSectionComponent,
    },
    [HELP_SECTION_IDS.CHILD_REPORTS]: {
      id: HELP_SECTION_IDS.CHILD_REPORTS,
      component: HelpChildReportsSectionComponent,
    },
    [HELP_SECTION_IDS.EXPORTS]: {
      id: HELP_SECTION_IDS.EXPORTS,
      component: HelpExportsSectionComponent,
    },
    [HELP_SECTION_IDS.OFFLINE_SYNC]: {
      id: HELP_SECTION_IDS.OFFLINE_SYNC,
      component: HelpOfflineSyncSectionComponent,
    },
    [HELP_SECTION_IDS.ADMIN_OPERATIONS]: {
      id: HELP_SECTION_IDS.ADMIN_OPERATIONS,
      component: HelpAdminOperationsSectionComponent,
    },
    [HELP_SECTION_IDS.ACCOUNT_SETTINGS]: {
      id: HELP_SECTION_IDS.ACCOUNT_SETTINGS,
      component: HelpAccountSettingsSectionComponent,
    },
  };

const ROLE_HELP_DEFINITIONS: readonly RoleHelpDefinition[] = [
  {
    role: APP_ROLES.ADMIN,
    sections: [
      HELP_SECTION_IDS.OVERVIEW,
      HELP_SECTION_IDS.REPORT_LIFECYCLE,
      HELP_SECTION_IDS.INSPECTION_EXECUTION,
      HELP_SECTION_IDS.APPROVALS,
      HELP_SECTION_IDS.CHILD_REPORTS,
      HELP_SECTION_IDS.EXPORTS,
      HELP_SECTION_IDS.OFFLINE_SYNC,
      HELP_SECTION_IDS.ADMIN_OPERATIONS,
      HELP_SECTION_IDS.ACCOUNT_SETTINGS,
    ],
  },
  {
    role: APP_ROLES.RECEIVER,
    sections: [
      HELP_SECTION_IDS.OVERVIEW,
      HELP_SECTION_IDS.REPORT_LIFECYCLE,
      HELP_SECTION_IDS.OFFLINE_SYNC,
      HELP_SECTION_IDS.ACCOUNT_SETTINGS,
    ],
  },
  {
    role: APP_ROLES.INSPECTOR,
    sections: [
      HELP_SECTION_IDS.OVERVIEW,
      HELP_SECTION_IDS.REPORT_LIFECYCLE,
      HELP_SECTION_IDS.INSPECTION_EXECUTION,
      HELP_SECTION_IDS.APPROVALS,
      HELP_SECTION_IDS.CHILD_REPORTS,
      HELP_SECTION_IDS.OFFLINE_SYNC,
      HELP_SECTION_IDS.ACCOUNT_SETTINGS,
    ],
  },
  {
    role: APP_ROLES.SUPERVISOR,
    sections: [
      HELP_SECTION_IDS.OVERVIEW,
      HELP_SECTION_IDS.REPORT_LIFECYCLE,
      HELP_SECTION_IDS.APPROVALS,
      HELP_SECTION_IDS.CHILD_REPORTS,
      HELP_SECTION_IDS.EXPORTS,
      HELP_SECTION_IDS.OFFLINE_SYNC,
      HELP_SECTION_IDS.ACCOUNT_SETTINGS,
    ],
  },
  {
    role: APP_ROLES.CUSTOMER,
    sections: [
      HELP_SECTION_IDS.OVERVIEW,
      HELP_SECTION_IDS.REPORT_LIFECYCLE,
      HELP_SECTION_IDS.EXPORTS,
      HELP_SECTION_IDS.OFFLINE_SYNC,
      HELP_SECTION_IDS.ACCOUNT_SETTINGS,
    ],
  },
];

@Injectable({ providedIn: 'root' })
export class HelpContentService {
  public isAppRole(value: string): value is AppRole {
    return (
      value === APP_ROLES.ADMIN ||
      value === APP_ROLES.RECEIVER ||
      value === APP_ROLES.INSPECTOR ||
      value === APP_ROLES.SUPERVISOR ||
      value === APP_ROLES.CUSTOMER
    );
  }

  public getSectionsForRole(role: AppRole): HelpSectionDefinition[] {
    const roleDef = ROLE_HELP_DEFINITIONS.find(
      (definition) => definition.role === role,
    );
    if (!roleDef) {
      return [];
    }

    return roleDef.sections.map((sectionId) => SECTION_REGISTRY[sectionId]);
  }
}
