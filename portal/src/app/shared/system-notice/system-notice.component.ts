import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SystemNoticeService } from '@portal/core/services/system-notice.service';

@Component({
  selector: 'app-system-notice',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './system-notice.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SystemNoticeComponent {
  public readonly notices = inject(SystemNoticeService);
}
