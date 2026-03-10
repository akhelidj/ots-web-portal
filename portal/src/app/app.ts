import { Component, OnInit, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterModule } from '@angular/router';
import { environment } from '../environments/environment';
import { ToastComponent } from './shared/toast/toast.component';

@Component({
  imports: [RouterModule, ToastComponent],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  protected title = 'portal';
  protected message = 'Loading health check...';
  private http = inject(HttpClient);

  ngOnInit() {
    this.http.get(environment.apiUrl + '/health').subscribe({
      next: (res) => {
        this.message = 'API Health Check: OK ' + JSON.stringify(res);
        console.log('API Health Check:', res);
      },
      error: (err) => {
        this.message = 'API Health Check Failed: ' + err.statusText;
        console.error('API Health Check Failed:', err);
      },
    });
  }
}
