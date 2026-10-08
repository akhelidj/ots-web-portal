/**
 * A SUPERVISOR has the same report powers as an ADMIN: for every report/child status the
 * UI policy must offer them the same transitions and actions.
 */
import { APP_ROLES, REPORT_STATUSES } from '../constants/app.constants';
import { getInspectionReportUiState } from './inspection-report-ui-policy';
import { getChildReportUiState } from './child-report-ui-policy';

const statuses = Object.values(REPORT_STATUSES);

describe('supervisor / admin UI-policy parity', () => {
  it.each(statuses)('inspection report in %s', (reportStatus) => {
    const ctx = { reportStatus, isOffline: false, previousStatus: 'IN_INSPECTION' };
    const admin = getInspectionReportUiState({ ...ctx, role: APP_ROLES.ADMIN });
    const sup = getInspectionReportUiState({ ...ctx, role: APP_ROLES.SUPERVISOR });
    expect(sup.transitionChoices).toEqual(admin.transitionChoices);
    expect(sup.actions).toEqual(admin.actions);
    expect(sup.fieldModes).toEqual(admin.fieldModes);
  });

  it('can intake, force-close and reopen', () => {
    const labels = (reportStatus: string) =>
      getInspectionReportUiState({
        role: APP_ROLES.SUPERVISOR,
        reportStatus: reportStatus as never,
        isOffline: false,
      }).transitionChoices.map((t) => t.label);
    expect(labels(REPORT_STATUSES.DRAFT)).toContain('Receive');
    expect(labels(REPORT_STATUSES.IN_INSPECTION)).toContain('Close');
    expect(labels(REPORT_STATUSES.APPROVED)).toContain('Reopen (Revision)');
    expect(labels(REPORT_STATUSES.CLOSED)).toContain('Reopen (Approved)');
  });

  it.each(['DRAFT', 'IN_INSPECTION', 'PENDING_APPROVAL', 'APPROVED', 'CLOSED'])(
    'child report in %s',
    (reportStatus) => {
      const ctx = {
        reportStatus: reportStatus as never,
        parentReportStatus: 'IN_INSPECTION',
        isOffline: false,
      };
      const admin = getChildReportUiState({ ...ctx, role: APP_ROLES.ADMIN });
      const sup = getChildReportUiState({ ...ctx, role: APP_ROLES.SUPERVISOR });
      expect(sup.transitionChoices).toEqual(admin.transitionChoices);
      expect(sup.fieldModes).toEqual(admin.fieldModes);
    },
  );
});
