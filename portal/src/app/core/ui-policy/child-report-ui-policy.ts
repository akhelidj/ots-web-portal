import {
  AppRole,
  ChildReportStatus,
  APP_ROLES,
  CHILD_REPORT_STATUSES,
  REPORT_STATUSES,
} from '../constants/app.constants';

export interface ChildReportUiPolicyContext {
  role: AppRole;
  reportStatus: ChildReportStatus;
  parentReportStatus: string;
  isOffline: boolean;
  syncState?: 'SYNCED' | 'PENDING' | 'CONFLICT';
}

export interface ActionState {
  visible: boolean;
  enabled: boolean;
  disabledReason?: string;
  requiresReason?: boolean;
}

export interface TransitionOption {
  toStatus: string;
  requiresReason: boolean;
  enabled: boolean;
  disabledReason?: string;
  label: string;
}

export interface Banner {
  type: 'info' | 'warning' | 'error' | 'success';
  message: string;
}

export interface ChildReportUiState {
  actions: Record<string, ActionState>;
  fieldModes: Record<string, 'hidden' | 'readonly' | 'editable'>;
  banners: Banner[];
  transitionChoices: TransitionOption[];
}

export function getChildReportUiState(
  ctx: ChildReportUiPolicyContext,
): ChildReportUiState {
  const state: ChildReportUiState = {
    actions: {},
    fieldModes: {
      inspectionData: 'readonly',
      disposition: 'readonly',
    },
    banners: [],
    transitionChoices: [],
  };

  if (ctx.parentReportStatus === REPORT_STATUSES.CLOSED) {
    state.banners.push({
      type: 'warning',
      message:
        'Parent Report is Closed. Modifications to Child Report are disabled.',
    });
    return state;
  }

  if (ctx.syncState === 'CONFLICT') {
    state.banners.push({
      type: 'error',
      message:
        'Sync Conflict: Record has been modified elsewhere. Please resolve or discard local changes.',
    });
  }

  if (ctx.reportStatus === CHILD_REPORT_STATUSES.PENDING_APPROVAL) {
    state.banners.push({
      type: 'info',
      message: 'Pending Approval — Inspector edits locked.',
    });
  }
  if (ctx.reportStatus === CHILD_REPORT_STATUSES.APPROVED) {
    state.banners.push({
      type: 'info',
      message:
        'Locked — Approved.' +
        (ctx.role === APP_ROLES.ADMIN || ctx.role === APP_ROLES.SUPERVISOR
          ? ' Admin edits create a Revision.'
          : ''),
    });
  }

  if (ctx.reportStatus === CHILD_REPORT_STATUSES.DRAFT) {
    state.banners.push({
      type: 'info',
      message: 'Draft — start the inspection before inspecting serials.',
    });
  }

  // Edit rules — mirror the server's child workflow matrix: serials are inspected only while
  // the child is IN_INSPECTION (a DRAFT child must be started first).
  if (ctx.syncState !== 'CONFLICT') {
    if (ctx.reportStatus === CHILD_REPORT_STATUSES.IN_INSPECTION) {
      if (
        (
          [
            APP_ROLES.INSPECTOR,
            APP_ROLES.ADMIN,
            APP_ROLES.SUPERVISOR,
          ] as readonly string[]
        ).includes(ctx.role)
      ) {
        state.fieldModes['inspectionData'] = 'editable';
        state.fieldModes['disposition'] = 'editable';
      }
    }
  }

  if (ctx.syncState !== 'CONFLICT') {
    if (ctx.reportStatus === CHILD_REPORT_STATUSES.DRAFT) {
      if (
        (
          [
            APP_ROLES.INSPECTOR,
            APP_ROLES.ADMIN,
            APP_ROLES.SUPERVISOR,
          ] as readonly string[]
        ).includes(ctx.role)
      ) {
        state.transitionChoices.push({
          toStatus: CHILD_REPORT_STATUSES.IN_INSPECTION,
          label: 'Start Inspection',
          requiresReason: false,
          enabled: true,
        });
      }
    } else if (ctx.reportStatus === CHILD_REPORT_STATUSES.IN_INSPECTION) {
      if (
        (
          [
            APP_ROLES.INSPECTOR,
            APP_ROLES.ADMIN,
            APP_ROLES.SUPERVISOR,
          ] as readonly string[]
        ).includes(ctx.role)
      ) {
        state.transitionChoices.push({
          toStatus: CHILD_REPORT_STATUSES.PENDING_APPROVAL,
          label: 'Submit for Approval',
          requiresReason: false,
          enabled: true,
        });
      }
    } else if (ctx.reportStatus === CHILD_REPORT_STATUSES.PENDING_APPROVAL) {
      if (
        ([APP_ROLES.SUPERVISOR, APP_ROLES.ADMIN] as readonly string[]).includes(
          ctx.role,
        )
      ) {
        state.transitionChoices.push({
          toStatus: CHILD_REPORT_STATUSES.APPROVED,
          label: 'Approve',
          requiresReason: false,
          enabled: true,
        });
      }
    } else if (ctx.reportStatus === CHILD_REPORT_STATUSES.APPROVED) {
      if (
        ([APP_ROLES.SUPERVISOR, APP_ROLES.ADMIN] as readonly string[]).includes(
          ctx.role,
        )
      ) {
        state.transitionChoices.push({
          toStatus: CHILD_REPORT_STATUSES.CLOSED,
          label: 'Close',
          requiresReason: false,
          enabled: true,
        });
      }
      if (
        ([APP_ROLES.ADMIN, APP_ROLES.SUPERVISOR] as readonly string[]).includes(
          ctx.role,
        )
      ) {
        state.transitionChoices.push({
          toStatus: CHILD_REPORT_STATUSES.IN_INSPECTION,
          label: 'Reopen (Revision)',
          requiresReason: true,
          enabled: true,
        });
      }
    }
    // CLOSED is terminal in the server's child matrix — no transition is offered.
  }

  return state;
}
