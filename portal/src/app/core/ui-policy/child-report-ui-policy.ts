export type UserRole = 'ADMIN' | 'RECEIVER' | 'INSPECTOR' | 'SUPERVISOR' | 'CUSTOMER';
export type ChildReportStatus = 'DRAFT' | 'IN_INSPECTION' | 'PENDING_APPROVAL' | 'APPROVED' | 'CLOSED';

export interface ChildReportUiPolicyContext {
  role: UserRole;
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
  toStatus: string; // The backend status to transition to
  requiresReason: boolean;
  enabled: boolean;
  disabledReason?: string;
  label: string; // Display label
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

export function getChildReportUiState(ctx: ChildReportUiPolicyContext): ChildReportUiState {
   const state: ChildReportUiState = {
      actions: {},
      fieldModes: {
         inspectionData: 'readonly',
         disposition: 'readonly'
      },
      banners: [],
      transitionChoices: []
   };

   if (ctx.parentReportStatus === 'CLOSED') {
      state.banners.push({ type: 'warning', message: 'Parent Report is Closed. Modifications to Child Report are disabled.' });
      return state; // No actions allowed
   }

   if (ctx.syncState === 'CONFLICT') {
      state.banners.push({ type: 'error', message: 'Sync Conflict: Record has been modified elsewhere. Please resolve or discard local changes.' });
   }
   
   if (ctx.reportStatus === 'PENDING_APPROVAL') {
      state.banners.push({ type: 'info', message: 'Pending Approval — Inspector edits locked.' });
   }
   if (ctx.reportStatus === 'APPROVED') {
      state.banners.push({ type: 'info', message: 'Locked — Approved.' + (ctx.role === 'ADMIN' ? ' Admin edits create a Revision.' : '') });
   }

   // Edit rules
   if (ctx.syncState !== 'CONFLICT') {
      if (['DRAFT', 'IN_INSPECTION'].includes(ctx.reportStatus)) {
         if (['INSPECTOR', 'ADMIN'].includes(ctx.role)) {
            state.fieldModes['inspectionData'] = 'editable';
            state.fieldModes['disposition'] = 'editable';
         }
      }
   }

   if (ctx.syncState !== 'CONFLICT') {
       if (ctx.reportStatus === 'DRAFT') {
           if (['INSPECTOR', 'ADMIN'].includes(ctx.role)) {
              state.transitionChoices.push({ toStatus: 'IN_INSPECTION', label: 'Start Inspection', requiresReason: false, enabled: true });
           }
       } else if (ctx.reportStatus === 'IN_INSPECTION') {
           if (['INSPECTOR', 'ADMIN'].includes(ctx.role)) {
              state.transitionChoices.push({ toStatus: 'PENDING_APPROVAL', label: 'Submit for Approval', requiresReason: false, enabled: true });
           }
       } else if (ctx.reportStatus === 'PENDING_APPROVAL') {
           if (['SUPERVISOR', 'ADMIN'].includes(ctx.role)) {
              state.transitionChoices.push({ toStatus: 'APPROVED', label: 'Approve', requiresReason: false, enabled: true });
              state.transitionChoices.push({ toStatus: 'IN_INSPECTION', label: 'Return', requiresReason: true, enabled: true });
           }
       } else if (ctx.reportStatus === 'APPROVED') {
           if (['SUPERVISOR', 'ADMIN'].includes(ctx.role)) {
              state.transitionChoices.push({ toStatus: 'CLOSED', label: 'Close', requiresReason: false, enabled: true });
           }
           if (['ADMIN'].includes(ctx.role)) {
              state.transitionChoices.push({ toStatus: 'IN_INSPECTION', label: 'Reopen (Revision)', requiresReason: true, enabled: true });
           }
       } else if (ctx.reportStatus === 'CLOSED') {
           if (['ADMIN'].includes(ctx.role)) {
              state.transitionChoices.push({ toStatus: 'APPROVED', label: 'Reopen (Approved)', requiresReason: true, enabled: true });
           }
       }
   }

   return state;
}
