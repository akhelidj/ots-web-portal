export type UserRole = 'ADMIN' | 'RECEIVER' | 'INSPECTOR' | 'SUPERVISOR' | 'CUSTOMER';
export type ReportStatus = 'DRAFT' | 'RECEIVED' | 'READY_FOR_CLEANING' | 'READY_FOR_INSPECTION' | 'IN_INSPECTION' | 'PENDING_APPROVAL' | 'APPROVED' | 'ON_HOLD' | 'CLOSED';

export interface UiPolicyContext {
  role: UserRole;
  reportStatus: ReportStatus;
  isOffline: boolean;
  hasValidationIssues?: boolean;
  syncState?: 'SYNCED' | 'PENDING' | 'CONFLICT';
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
   if (ctx.reportStatus === 'ON_HOLD') {
      state.banners.push({ type: 'warning', message: `On Hold — reason: ${ctx.onHoldReason || 'Unknown'}, previous status: ${ctx.previousStatus || 'Unknown'}` });
   }
   if (ctx.reportStatus === 'PENDING_APPROVAL') {
      state.banners.push({ type: 'info', message: 'Pending Approval — Inspector edits locked.' });
   }
   if (ctx.reportStatus === 'APPROVED') {
      state.banners.push({ type: 'info', message: 'Locked — Approved (exportable).' + (ctx.role === 'ADMIN' ? ' Admin edits create a Revision.' : '') });
   }
   if (ctx.reportStatus === 'CLOSED') {
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
   if (['INSPECTOR', 'SUPERVISOR', 'ADMIN'].includes(ctx.role)) {
       state.actions['IR_EDIT_SERIAL'] = { visible: true, enabled: true };
   }
   
   // Apply Role + Status constraints
   if (ctx.syncState !== 'CONFLICT') {
       if (ctx.reportStatus === 'DRAFT') {
          if (ctx.role === 'RECEIVER' || ctx.role === 'ADMIN') {
             state.fieldModes['customerId'] = 'editable';
             state.fieldModes['poNumber'] = 'editable';
             state.fieldModes['serialNumbers'] = 'editable';
             state.actions['IR_ADD_SERIAL'] = { visible: true, enabled: true };
             state.actions['IR_EDIT_SERIAL'] = { visible: true, enabled: true };
             state.actions['IR_REMOVE_SERIAL'] = { visible: true, enabled: true };
          }
       } else if (ctx.reportStatus === 'RECEIVED' || ctx.reportStatus === 'READY_FOR_CLEANING') {
          if (ctx.role === 'RECEIVER' || ctx.role === 'ADMIN') {
             state.fieldModes['serialNumbers'] = 'editable';
             state.actions['IR_ADD_SERIAL'] = { visible: true, enabled: true };
             state.actions['IR_EDIT_SERIAL'] = { visible: true, enabled: true };
             state.actions['IR_REMOVE_SERIAL'] = { visible: true, enabled: true };
          }
       } else if (ctx.reportStatus === 'READY_FOR_INSPECTION') {
          if (ctx.role === 'ADMIN') {
             state.fieldModes['serialNumbers'] = 'editable';
             state.actions['IR_EDIT_SERIAL'] = { visible: true, enabled: true };
          }
       } else if (ctx.reportStatus === 'IN_INSPECTION') {
          if (ctx.role === 'INSPECTOR' || ctx.role === 'ADMIN') {
             state.fieldModes['inspectionData'] = 'editable';
             state.fieldModes['disposition'] = 'editable';
             state.actions['IR_EDIT_META'] = { visible: true, enabled: true };
             state.actions['SN_EDIT_INSPECTION_DATA'] = { visible: true, enabled: true };
             state.actions['SN_SET_DISPOSITION'] = { visible: true, enabled: true };
             state.actions['CR_CREATE_FROM_REWORK'] = { visible: true, enabled: true };
             
             if (ctx.role === 'INSPECTOR') {
                state.actions['IR_EDIT_SERIAL'] = { visible: true, enabled: true, requiresReason: true };
             }
          }
       } else if (ctx.reportStatus === 'APPROVED') {
          if (ctx.role === 'ADMIN') {
             state.actions['ADMIN_EDIT_ANYTIME'] = { visible: true, enabled: true, requiresReason: true };
          }
       }
   }

   // Target Export visibility via Roles
   if (['CUSTOMER', 'ADMIN', 'SUPERVISOR'].includes(ctx.role)) {
      const isApprovedOrClosed = ctx.reportStatus === 'APPROVED' || ctx.reportStatus === 'CLOSED';
      const isExportEnabled = isApprovedOrClosed && !ctx.isOffline;
      const disabledReason = !isApprovedOrClosed ? 'Only available when Approved or Closed.' : (ctx.isOffline ? 'Export requires internet connection.' : undefined);
      
      const key = ctx.role === 'CUSTOMER' ? 'CUSTOMER_EXPORT' : 'ADMIN_EXPORT';
      state.actions[key] = {
         visible: true,
         enabled: isExportEnabled,
         disabledReason: disabledReason
      };
   }

   // Transition logic
   if (ctx.syncState !== 'CONFLICT') {
       if (ctx.reportStatus === 'DRAFT') {
          if (['RECEIVER', 'ADMIN'].includes(ctx.role)) {
             state.transitionChoices.push({ toStatus: 'RECEIVED', label: 'Receive', requiresReason: false, enabled: true });
          }
          if (['SUPERVISOR', 'ADMIN'].includes(ctx.role)) {
             state.transitionChoices.push({ toStatus: 'ON_HOLD', label: 'Hold', requiresReason: true, enabled: true });
          }
          if (['ADMIN'].includes(ctx.role)) {
             state.transitionChoices.push({ toStatus: 'CLOSED', label: 'Close', requiresReason: false, enabled: true });
          }
       } else if (ctx.reportStatus === 'RECEIVED') {
          if (['RECEIVER', 'SUPERVISOR', 'ADMIN'].includes(ctx.role)) {
             state.transitionChoices.push({ toStatus: 'READY_FOR_CLEANING', label: 'Send to Cleaning', requiresReason: false, enabled: true });
          }
          if (['SUPERVISOR', 'ADMIN'].includes(ctx.role)) {
             state.transitionChoices.push({ toStatus: 'ON_HOLD', label: 'Hold', requiresReason: true, enabled: true });
          }
          if (['ADMIN'].includes(ctx.role)) {
             state.transitionChoices.push({ toStatus: 'CLOSED', label: 'Close', requiresReason: false, enabled: true });
          }
       } else if (ctx.reportStatus === 'READY_FOR_CLEANING') {
          if (['RECEIVER', 'SUPERVISOR', 'ADMIN'].includes(ctx.role)) {
             state.transitionChoices.push({ toStatus: 'READY_FOR_INSPECTION', label: 'Send to Inspection', requiresReason: false, enabled: true });
          }
          if (['SUPERVISOR', 'ADMIN'].includes(ctx.role)) {
             state.transitionChoices.push({ toStatus: 'ON_HOLD', label: 'Hold', requiresReason: true, enabled: true });
          }
          if (['ADMIN'].includes(ctx.role)) {
             state.transitionChoices.push({ toStatus: 'CLOSED', label: 'Close', requiresReason: false, enabled: true });
          }
       } else if (ctx.reportStatus === 'READY_FOR_INSPECTION') {
          if (['INSPECTOR', 'SUPERVISOR', 'ADMIN'].includes(ctx.role)) {
             state.transitionChoices.push({ toStatus: 'IN_INSPECTION', label: 'Start Inspection', requiresReason: false, enabled: true });
          }
          if (['SUPERVISOR', 'ADMIN'].includes(ctx.role)) {
             state.transitionChoices.push({ toStatus: 'ON_HOLD', label: 'Hold', requiresReason: true, enabled: true });
          }
          if (['ADMIN'].includes(ctx.role)) {
             state.transitionChoices.push({ toStatus: 'CLOSED', label: 'Close', requiresReason: false, enabled: true });
          }
       } else if (ctx.reportStatus === 'IN_INSPECTION') {
          if (['INSPECTOR', 'ADMIN'].includes(ctx.role)) {
             state.transitionChoices.push({ toStatus: 'PENDING_APPROVAL', label: 'Submit for Approval', requiresReason: false, enabled: !ctx.hasValidationIssues, disabledReason: ctx.hasValidationIssues ? 'Cannot submit until all validation issues are resolved.' : undefined });
          }
          if (['INSPECTOR', 'SUPERVISOR', 'ADMIN'].includes(ctx.role)) {
             state.transitionChoices.push({ toStatus: 'ON_HOLD', label: 'Hold', requiresReason: true, enabled: true });
          }
          if (['ADMIN'].includes(ctx.role)) {
             state.transitionChoices.push({ toStatus: 'CLOSED', label: 'Close', requiresReason: false, enabled: true });
          }
       } else if (ctx.reportStatus === 'PENDING_APPROVAL') {
          if (['SUPERVISOR', 'ADMIN'].includes(ctx.role)) {
             state.transitionChoices.push({ toStatus: 'APPROVED', label: 'Approve', requiresReason: false, enabled: !ctx.hasValidationIssues, disabledReason: ctx.hasValidationIssues ? 'Validation failed.' : undefined });
             state.transitionChoices.push({ toStatus: 'IN_INSPECTION', label: 'Return', requiresReason: true, enabled: true });
             state.transitionChoices.push({ toStatus: 'ON_HOLD', label: 'Hold', requiresReason: true, enabled: true });
          }
          if (['ADMIN'].includes(ctx.role)) {
             state.transitionChoices.push({ toStatus: 'CLOSED', label: 'Close', requiresReason: false, enabled: true });
          }
       } else if (ctx.reportStatus === 'APPROVED') {
          if (['SUPERVISOR', 'ADMIN'].includes(ctx.role)) {
             state.transitionChoices.push({ toStatus: 'ON_HOLD', label: 'Hold', requiresReason: true, enabled: true });
             state.transitionChoices.push({ toStatus: 'CLOSED', label: 'Close', requiresReason: false, enabled: true });
          }
          if (['ADMIN'].includes(ctx.role)) {
             state.transitionChoices.push({ toStatus: 'IN_INSPECTION', label: 'Reopen (Revision)', requiresReason: true, enabled: true });
          }
       } else if (ctx.reportStatus === 'ON_HOLD') {
          if (['SUPERVISOR', 'ADMIN'].includes(ctx.role)) {
             state.transitionChoices.push({ toStatus: ctx.previousStatus || 'DRAFT', label: 'Release Hold', requiresReason: false, enabled: true });
             state.transitionChoices.push({ toStatus: 'CLOSED', label: 'Close', requiresReason: false, enabled: true });
          }
       } else if (ctx.reportStatus === 'CLOSED') {
          if (['ADMIN'].includes(ctx.role)) {
             state.transitionChoices.push({ toStatus: 'APPROVED', label: 'Reopen (Approved)', requiresReason: true, enabled: true });
             state.transitionChoices.push({ toStatus: 'IN_INSPECTION', label: 'Reopen (In Inspection)', requiresReason: true, enabled: true });
          }
       }
   }

   return state;
}
