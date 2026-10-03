import { Component, input } from '@angular/core';

@Component({
  selector: 'app-page-identity',
  standalone: true,
  templateUrl: './page-identity.component.html',
  styleUrl: './page-identity.component.scss',
})
export class PageIdentityComponent {
  title = input.required<string>();
}
