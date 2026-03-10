import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ConnectivityService } from '@portal/core/offline/services/connectivity.service';

@Component({
  selector: 'app-auth-required',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './auth-required.component.html',
})
export class AuthRequiredComponent {
  public isOnline = inject(ConnectivityService).isOnline;
}
