import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { ToastService } from '../services/toast.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const toastService = inject(ToastService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      let errorMsg = 'An unexpected network error occurred.';
      let errorTitle = 'Network Error';

      if (error.error instanceof ErrorEvent) {
        // Client-side or network error
        errorMsg = error.error.message;
        errorTitle = 'Client Error';
      } else {
        // Backend returned an unsuccessful response code
        if (error.status === 401) {
             // Let JWT handle 401 or keep quiet depending on logic, or show explicitly:
             errorTitle = 'Unauthorized';
             errorMsg = 'Your session has expired or is invalid. Please log in again.';
        } else if (error.status === 403) {
             errorTitle = 'Forbidden';
             errorMsg = 'You do not have permission to perform this action.';
        } else if (error.status === 400) {
             errorTitle = 'Bad Request';
             if (typeof error.error?.message === 'string') {
                 errorMsg = error.error.message;
             } else if (typeof error.error?.error === 'string') {
                 errorMsg = error.error.error;
             } else if (typeof error.error === 'string') {
                 errorMsg = error.error;
             } else {
                 errorMsg = 'The submitted data was invalid or incomplete.';
             }
        } else if (error.status === 404) {
             errorTitle = 'Not Found';
             errorMsg = 'The requested resource could not be found.';
        } else if (error.status === 409) {
             errorTitle = 'Conflict';
             errorMsg = error.error?.message || 'Data conflict occurred. Please refresh and try again.';
        } else if (error.status >= 500) {
             errorTitle = 'Server Error';
             errorMsg = 'The server encountered an error processing your request.';
        } else if (error.status === 0) {
             errorTitle = 'Connection Refused';
             errorMsg = 'Cannot reach the server. Please check your internet connection.';
        } else {
             errorTitle = `Error ${error.status}`;
             errorMsg = error.message;
        }
      }

      toastService.showError(errorMsg, errorTitle);
      
      // Re-throw so components can still handle it if they want
      return throwError(() => error);
    })
  );
};
