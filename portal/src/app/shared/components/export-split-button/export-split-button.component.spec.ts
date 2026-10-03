import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ExportFormat,
  ExportSplitButtonComponent,
} from './export-split-button.component';

describe('ExportSplitButtonComponent', () => {
  let fixture: ComponentFixture<ExportSplitButtonComponent>;
  let emitted: ExportFormat[];

  const el = () => fixture.nativeElement as HTMLElement;
  const buttons = () => Array.from(el().querySelectorAll('button'));
  const menuItems = () =>
    Array.from(el().querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ExportSplitButtonComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(ExportSplitButtonComponent);
    emitted = [];
    fixture.componentInstance.exportRequested.subscribe((f) => emitted.push(f));
    fixture.detectChanges();
  });

  it('exports a PDF from the main button', () => {
    buttons()[0].click();
    expect(emitted).toEqual(['pdf']);
  });

  it('offers PDF and Excel in the menu', () => {
    buttons()[1].click();
    fixture.detectChanges();
    expect(menuItems().length).toBe(2);
    menuItems()[1].click();
    expect(emitted).toEqual(['xlsx']);
  });

  it('locks the formats but keeps the menu reachable, and shows the reason', () => {
    fixture.componentRef.setInput('blocked', true);
    fixture.componentRef.setInput('reason', 'Waiting for signature: QA (supervisor).');
    fixture.detectChanges();

    expect(buttons()[0].disabled).toBe(true);
    expect(buttons()[1].disabled).toBe(false);

    buttons()[1].click();
    fixture.detectChanges();
    const [pdf, xlsx] = menuItems();
    expect(pdf.disabled).toBe(true);
    expect(xlsx.disabled).toBe(true);
    expect(el().querySelector('[data-testid="export-menu-reason"]')?.textContent).toContain(
      'QA (supervisor)',
    );
  });

  it('disables everything that needs the network when offline', () => {
    fixture.componentRef.setInput('isOnline', false);
    fixture.detectChanges();
    buttons()[1].click();
    fixture.detectChanges();
    expect(menuItems().every((i) => i.disabled)).toBe(true);
  });
});
