import { AppRole, ReportStatus, APP_ROLES, REPORT_STATUSES } from '../constants/app.constants';

export interface UiPolicyContext {
  role: AppRole;
  reportStatus: ReportStatus;
  isOffline: boolean;
  hasValidationIssues?: boolean;
  syncState?: 'SYNCED' | 'PENDING' | 'CONFLICT' | 'ERROR';
  previousStatus?: string | null;
  onHoldReason?: string | null;
  version?: number;
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

export interface InspectionReportUiState {
  actions: Record<string, ActionState>;
  fieldModes: Record<string, 'hidden' | 'readonly' | 'editable'>;
  banners: Banner[];
  transitionChoices: TransitionOption[];
}

export function getInspectionReportUiState(ctx: UiPolicyContext): InspectionReportUiState {
   const state: InspectionReportUiState = {
      actions: {},
      fieldModes: {
         customerId: 'readonly',
         poNumber: 'readonly',
         templateBinding: 'readonly',
         serialNumbers: 'readonly',
         inspectionData: 'readonly',
         disposition: 'readonly',
         childReports: 'readonly'
      },
      banners: [],
      transitionChoices: []
   };

   // Banners
   if (ctx.syncState === 'CONFLICT') {
      state.banners.push({ type: 'error', message: 'Sync Conflict: Record has been modified elsewhere. Please resolve or discard local changes.' });
   }
   if (ctx.reportStatus === REPORT_STATUSES.ON_HOLD) {
      state.banners.push({ type: 'warning', message: `On Hold — reason: ${ctx.onHoldReason || 'Unknown'}, previous status: ${ctx.previousStatus || 'Unknown'}` });
   }
    if (ctx.reportStatus === REPORT_STATUSES.PENDING_APPROVAL) {
      // Legacy status, should not happen in new batch flow, but kept for UI safety
      state.banners.push({ type: 'info', message: 'Pending Approval — Inspector edits locked.' });
    }
   if (ctx.reportStatus === REPORT_STATUSES.APPROVED) {
      state.banners.push({ type: 'info', message: 'Locked — Approved (exportable).' + (ctx.role === APP_ROLES.ADMIN ? ' Admin edits create a Revision.' : '') });
   }
   if (ctx.reportStatus === REPORT_STATUSES.CLOSED) {
      state.banners.push({ type: 'info', message: 'Locked — Closed (exportable).' });
   }

   // Default actions
   state.actions['IR_CREATE'] = { visible: false, enabled: false };
   state.actions['IR_ADD_SERIAL'] = { visible: false, enabled: false };
   state.actions['IR_EDIT_SERIAL'] = { visible: false, enabled: false };
   state.actions['IR_REMOVE_SERIAL'] = { visible: false, enabled: false };
   state.actions['IR_EDIT_META'] = { visible: false, enabled: false };
   state.actions['SN_EDIT_INSPECTION_DATA'] = { visible: false, enabled: false };
   state.actions['SN_SET_DISPOSITION'] = { visible: false, enabled: false };
   state.actions['CR_CREATE_FROM_REWORK'] = { visible: false, enabled: false };
   state.actions['CUSTOMER_EXPORT'] = { visible: false, enabled: false };
   state.actions['ADMIN_EXPORT'] = { visible: false, enabled: false };

   // Enable Job Data edits for Inspector/Supervisor unconditionally for the UI button
   if ([APP_ROLES.INSPECTOR, APP_ROLES.SUPERVISOR, APP_ROLES.ADMIN].some(r => r === ctx.role)) {
       state.actions['IR_EDIT_SERIAL'] = { visible: true, enabled: true };
   }
   
   // Apply Role + Status constraints
   if (ctx.syncState !== 'CONFLICT') {
        if (ctx.reportStatus === REPORT_STATUSES.DRAFT) {
           if (ctx.role === APP_ROLES.RECEIVER || ctx.role === APP_ROLES.ADMIN) {
              state.fieldModes['customerId'] = 'editable';
              state.fieldModes['poNumber'] = 'editable';
              state.fieldModes['serialNumbers'] = 'editable';
              state.actions['IR_ADD_SERIAL'] = { visible: true, enabled: true };
              state.actions['IR_EDIT_SERIAL'] = { visible: true, enabled: true };
              state.actions['IR_REMOVE_SERIAL'] = { visible: true, enabled: true };
           }
        } else if (ctx.reportStatus === REPORT_STATUSES.RECEIVED || ctx.reportStatus === REPORT_STATUSES.READY_FOR_CLEANING) {
           if (ctx.role === APP_ROLES.RECEIVER || ctx.role === APP_ROLES.ADMIN) {
              state.fieldModes['serialNumbers'] = 'editable';
              state.actions['IR_ADD_SERIAL'] = { visible: true, enabled: true };
              state.actions['IR_EDIT_SERIAL'] = { visible: true, enabled: true };
              state.actions['IR_REMOVE_SERIAL'] = { visible: true, enabled: true };
           }
        } else if (ctx.reportStatus === REPORT_STATUSES.READY_FOR_INSPECTION) {
           if (ctx.role === APP_ROLES.ADMIN) {
              state.fieldModes['serialNumbers'] = 'editable';
              state.actions['IR_EDIT_SERIAL'] = { visible: true, enabled: true };
           }
        } else if (ctx.reportStatus === REPORT_STATUSES.IN_INSPECTION) {
           if (ctx.role === APP_ROLES.INSPECTOR || ctx.role === APP_ROLES.ADMIN) {
              state.fieldModes['inspectionData'] = 'editable';
              state.fieldModes['disposition'] = 'editable';
              state.actions['IR_EDIT_META'] = { visible: true, enabled: true };
              state.actions['SN_EDIT_INSPECTION_DATA'] = { visible: true, enabled: true };
              state.actions['SN_SET_DISPOSITION'] = { visible: true, enabled: true };
              state.actions['CR_CREATE_FROM_REWORK'] = { visible: true, enabled: true };
              
              if (ctx.role === APP_ROLES.INSPECTOR) {
                 state.actions['IR_EDIT_SERIAL'] = { visible: true, enabled: true, requiresReason: true };
              }
           }
        } else if (ctx.reportStatus === REPORT_STATUSES.APPROVED) {
           if (ctx.role === APP_ROLES.ADMIN) {
              state.actions['ADMIN_EDIT_ANYTIME'] = { visible: true, enabled: true, requiresReason: true };
           }
        }
   }

   // Target Export visibility via Roles
   if ([APP_ROLES.CUSTOMER, APP_ROLES.ADMIN, APP_ROLES.SUPERVISOR].some(r => r === ctx.role)) {
      const isApprovedOrClosed = ctx.reportStatus === REPORT_STATUSES.APPROVED || ctx.reportStatus === REPORT_STATUSES.CLOSED;
      const isExportEnabled = isApprovedOrClosed && !ctx.isOffline;
      const disabledReason = !isApprovedOrClosed ? 'Only available when Approved or Closed.' : (ctx.isOffline ? 'Export requires internet connection.' : undefined);
      
      const key = ctx.role === APP_ROLES.CUSTOMER ? 'CUSTOMER_EXPORT' : 'ADMIN_EXPORT';
      state.actions[key] = {
         visible: true,
         enabled: isExportEnabled,
         disabledReason: disabledReason
      };
   }

   // Transition logic
   if (ctx.syncState !== 'CONFLICT') {
        if (ctx.reportStatus === REPORT_STATUSES.DRAFT) {
           if ([APP_ROLES.RECEIVER, APP_ROLES.ADMIN].some(r => r === ctx.role)) {
              state.transitionChoices.push({ toStatus: REPORT_STATUSES.RECEIVED, label: 'Receive', requiresReason: false, enabled: true });
           }
           if ([APP_ROLES.SUPERVISOR, APP_ROLES.ADMIN].some(r => r === ctx.role)) {
              state.transitionChoices.push({ toStatus: REPORT_STATUSES.ON_HOLD, label: 'Hold', requiresReason: true, enabled: true });
           }
           if ([APP_ROLES.ADMIN].some(r => r === ctx.role)) {
              state.transitionChoices.push({ toStatus: REPORT_STATUSES.CLOSED, label: 'Close', requiresReason: false, enabled: true });
           }
        } else if (ctx.reportStatus === REPORT_STATUSES.RECEIVED) {
           if ([APP_ROLES.RECEIVER, APP_ROLES.SUPERVISOR, APP_ROLES.ADMIN].some(r => r === ctx.role)) {
              state.transitionChoices.push({ toStatus: REPORT_STATUSES.READY_FOR_CLEANING, label: 'Send to Cleaning', requiresReason: false, enabled: true });
           }
           if ([APP_ROLES.SUPERVISOR, APP_ROLES.ADMIN].some(r => r === ctx.role)) {
              state.transitionChoices.push({ toStatus: REPORT_STATUSES.ON_HOLD, label: 'Hold', requiresReason: true, enabled: true });
           }
           if ([APP_ROLES.ADMIN].some(r => r === ctx.role)) {
              state.transitionChoices.push({ toStatus: REPORT_STATUSES.CLOSED, label: 'Close', requiresReason: false, enabled: true });
           }
        } else if (ctx.reportStatus === REPORT_STATUSES.READY_FOR_CLEANING) {
           if ([APP_ROLES.RECEIVER, APP_ROLES.SUPERVISOR, APP_ROLES.ADMIN].some(r => r === ctx.role)) {
              state.transitionChoices.push({ toStatus: REPORT_STATUSES.READY_FOR_INSPECTION, label: 'Send to Inspection', requiresReason: false, enabled: true });
           }
           if ([APP_ROLES.SUPERVISOR, APP_ROLES.ADMIN].some(r => r === ctx.role)) {
              state.transitionChoices.push({ toStatus: REPORT_STATUSES.ON_HOLD, label: 'Hold', requiresReason: true, enabled: true });
           }
           if ([APP_ROLES.ADMIN].some(r => r === ctx.role)) {
              state.transitionChoices.push({ toStatus: REPORT_STATUSES.CLOSED, label: 'Close', requiresReason: false, enabled: true });
           }
        } else if (ctx.reportStatus === REPORT_STATUSES.READY_FOR_INSPECTION) {
           if ([APP_ROLES.INSPECTOR, APP_ROLES.SUPERVISOR, APP_ROLES.ADMIN].some(r => r === ctx.role)) {
              state.transitionChoices.push({ toStatus: REPORT_STATUSES.IN_INSPECTION, label: 'Start Inspection', requiresReason: false, enabled: true });
           }
           if ([APP_ROLES.SUPERVISOR, APP_ROLES.ADMIN].some(r => r === ctx.role)) {
              state.transitionChoices.push({ toStatus: REPORT_STATUSES.ON_HOLD, label: 'Hold', requiresReason: true, enabled: true });
           }
           if ([APP_ROLES.ADMIN].some(r => r === ctx.role)) {
              state.transitionChoices.push({ toStatus: REPORT_STATUSES.CLOSED, label: 'Close', requiresReason: false, enabled: true });
           }
         } else if (ctx.reportStatus === REPORT_STATUSES.IN_INSPECTION) {
            // Note: Report-level "Submit for Approval" is removed. Approval is now handled via Serial Number batches.
           if ([APP_ROLES.INSPECTOR, APP_ROLES.SUPERVISOR, APP_ROLES.ADMIN].some(r => r === ctx.role)) {
              state.transitionChoices.push({ toStatus: REPORT_STATUSES.ON_HOLD, label: 'Hold', requiresReason: true, enabled: true });
           }
           if ([APP_ROLES.ADMIN].some(r => r === ctx.role)) {
              state.transitionChoices.push({ toStatus: REPORT_STATUSES.CLOSED, label: 'Close', requiresReason: false, enabled: true });
           }
         } else if (ctx.reportStatus === REPORT_STATUSES.PENDING_APPROVAL) {
            // Legacy transitions for backwards compatibility during rollout
            if ([APP_ROLES.SUPERVISOR, APP_ROLES.ADMIN].some(r => r === ctx.role)) {
               state.transitionChoices.push({ toStatus: REPORT_STATUSES.APPROVED, label: 'Approve', requiresReason: false, enabled: !ctx.hasValidationIssues, disabledReason: ctx.hasValidationIssues ? 'Validation failed.' : undefined });
               state.transitionChoices.push({ toStatus: REPORT_STATUSES.IN_INSPECTION, label: 'Return', requiresReason: true, enabled: true });
               state.transitionChoices.push({ toStatus: REPORT_STATUSES.ON_HOLD, label: 'Hold', requiresReason: true, enabled: true });
            }
            if ([APP_ROLES.ADMIN].some(r => r === ctx.role)) {
               state.transitionChoices.push({ toStatus: REPORT_STATUSES.CLOSED, label: 'Close', requiresReason: false, enabled: true });
            }
        } else if (ctx.reportStatus === REPORT_STATUSES.APPROVED) {
           if ([APP_ROLES.SUPERVISOR, APP_ROLES.ADMIN].some(r => r === ctx.role)) {
              state.transitionChoices.push({ toStatus: REPORT_STATUSES.ON_HOLD, label: 'Hold', requiresReason: true, enabled: true });
              state.transitionChoices.push({ toStatus: REPORT_STATUSES.CLOSED, label: 'Close', requiresReason: false, enabled: true });
           }
           if ([APP_ROLES.ADMIN].some(r => r === ctx.role)) {
              state.transitionChoices.push({ toStatus: REPORT_STATUSES.IN_INSPECTION, label: 'Reopen (Revision)', requiresReason: true, enabled: true });
           }
        } else if (ctx.reportStatus === REPORT_STATUSES.ON_HOLD) {
           if ([APP_ROLES.SUPERVISOR, APP_ROLES.ADMIN].some(r => r === ctx.role)) {
              state.transitionChoices.push({ toStatus: ctx.previousStatus || REPORT_STATUSES.DRAFT, label: 'Release Hold', requiresReason: false, enabled: true });
              state.transitionChoices.push({ toStatus: REPORT_STATUSES.CLOSED, label: 'Close', requiresReason: false, enabled: true });
           }
        } else if (ctx.reportStatus === REPORT_STATUSES.CLOSED) {
           if ([APP_ROLES.ADMIN].some(r => r === ctx.role)) {
              state.transitionChoices.push({ toStatus: REPORT_STATUSES.APPROVED, label: 'Reopen (Approved)', requiresReason: true, enabled: true });
              state.transitionChoices.push({ toStatus: REPORT_STATUSES.IN_INSPECTION, label: 'Reopen (In Inspection)', requiresReason: true, enabled: true });
           }
        }
   }

   return state;
}
