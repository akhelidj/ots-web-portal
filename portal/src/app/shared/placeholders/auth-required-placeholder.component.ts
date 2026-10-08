import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConnectivityService } from '../../core/offline/connectivity.service';

@Component({
  selector: 'app-auth-required-placeholder',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './auth-required-placeholder.component.html',
})
export class AuthRequiredPlaceholderComponent {
  public isOnline$ = inject(ConnectivityService).isOnline$;
}
