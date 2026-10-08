import { CommonModule } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import {
  TimelineEvent,
  buildTimeline,
  eventLabel,
  formatDuration,
  stageLabel,
} from './report-timeline';

/**
 * One report's timeline: turnaround summary → time spent in each stage (proportional
 * bar + legend) → the event table with how long each step took. Admin Metrics only.
 */
@Component({
  selector: 'app-report-timeline',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './report-timeline.component.html',
})
export class ReportTimelineComponent {
  public readonly events = input<readonly TimelineEvent[]>([]);

  protected readonly timeline = computed(() => buildTimeline(this.events()));

  protected readonly eventLabel = eventLabel;
  protected readonly stageLabel = stageLabel;
  protected readonly formatDuration = formatDuration;
}
