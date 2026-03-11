import { Component, input } from '@angular/core';

@Component({
  selector: 'app-page-secondary-panel',
  standalone: true,
  templateUrl: './page-secondary-panel.component.html',
  styleUrl: './page-secondary-panel.component.scss'
})
export class PageSecondaryPanelComponent {
  title = input<string>();
}
