import { Component, OnInit, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterModule } from '@angular/router';
import { environment } from '@app-env/environment';
import { ToastComponent } from '@portal/shared/toast/toast.component';

@Component({
  imports: [RouterModule, ToastComponent],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  private http = inject(HttpClient);

  ngOnInit() {
    this.http.get(environment.apiUrl + '/health').subscribe({
      next: () => {
        // no-op health check warm-up
      },
      error: () => {
        // no-op: app handles API failures where needed
      },
    });
  }
}
