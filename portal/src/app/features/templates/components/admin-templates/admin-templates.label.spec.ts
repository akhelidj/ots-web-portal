/**
 * The templates-list row action LABELLED BY DEFINITION STATUS — DOM-level, through the real
 * zoneless scheduler (autoDetectChanges + whenStable, no manual detectChanges).
 *
 * A template that already carries a stored `definitionJson` (fields present) opens as the
 * read-only recap, so its row action reads "View"; a never-defined one opens the authoring
 * wizard, so it reads "Define". Both point at the SAME `…/define` route — only the word
 * changes — and the word is driven off the same `isTemplateDefined` predicate the Define
 * page's read-only branch uses, so the list and the recap can't disagree.
 */
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AdminTemplatesComponent } from './admin-templates.component';
import {
  AdminTemplateItem,
  AdminTemplatesService,
} from '@portal/features/templates/services/admin-templates.service';
import { ConnectivityService } from '@portal/core/offline/services/connectivity.service';
import { UserPreferencesService } from '@portal/core/services/user-preferences.service';

const DEFINED: AdminTemplateItem = {
  id: 'defined-1',
  templateKey: 'CASING_REPORT',
  templateVersion: 2,
  status: 'ACTIVE',
  changeNote: 'defined',
  createdAt: new Date().toISOString(),
  createdById: 'u1',
  definitionJson: {
    fields: [
      { key: 'sn', label: 'Serial Number', type: 'text', required: false, scope: 'item', role: 'serialNumber' },
    ],
  },
};

const UNDEFINED: AdminTemplateItem = {
  id: 'undefined-1',
  templateKey: 'DRILL_PIPE_REPORT',
  templateVersion: 1,
  status: 'ACTIVE',
  changeNote: 'not yet defined',
  createdAt: new Date().toISOString(),
  createdById: 'u1',
  definitionJson: null,
};

describe('AdminTemplatesComponent — row action label by definition status', () => {
  afterEach(() => TestBed.resetTestingModule());

  async function render(): Promise<ComponentFixture<AdminTemplatesComponent>> {
    TestBed.configureTestingModule({
      imports: [AdminTemplatesComponent],
      providers: [
        provideRouter([]),
        {
          provide: AdminTemplatesService,
          useValue: {
            templates: signal<AdminTemplateItem[]>([DEFINED, UNDEFINED]),
            fetchAll: jest.fn(),
          },
        },
        { provide: ConnectivityService, useValue: { isOnline: signal(true) } },
        {
          provide: UserPreferencesService,
          useValue: { preferences: signal({ compactMode: false }) },
        },
      ],
    });
    const fixture = TestBed.createComponent(AdminTemplatesComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    return fixture;
  }

  const anchorFor = (
    f: ComponentFixture<AdminTemplatesComponent>,
    id: string,
  ) =>
    (f.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>(
      `a[href="/admin/templates/${id}/define"]`,
    );

  it('reads "View" for a defined template — same /define route', async () => {
    const f = await render();
    const a = anchorFor(f, 'defined-1');
    expect(a).not.toBeNull();
    expect(a!.textContent?.trim()).toBe('View');
  });

  it('reads "Define" for a never-defined template — same /define route', async () => {
    const f = await render();
    const a = anchorFor(f, 'undefined-1');
    expect(a).not.toBeNull();
    expect(a!.textContent?.trim()).toBe('Define');
  });
});
