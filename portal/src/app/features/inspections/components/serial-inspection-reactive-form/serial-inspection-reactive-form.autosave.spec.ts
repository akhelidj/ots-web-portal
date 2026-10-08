/**
 * Autosave contract of the serial inspection form (generic definition — no template
 * specifics): drafts go to the record they were typed against, after a pause in typing,
 * without validation; switching record flushes the OUTGOING record first; read-only and
 * unchanged forms never save.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SerialInspectionReactiveFormComponent } from './serial-inspection-reactive-form.component';
import { TemplateFormDefinition } from '@portal/features/templates/schemas/definition-to-form-schema';

const DEFINITION: TemplateFormDefinition = {
  templateKey: 'ARBITRARY_REPORT',
  templateVersion: 1,
  sections: [{ key: 'meta', title: 'Metadata' }],
  fields: [
    {
      key: 'meta.name',
      label: 'Name',
      type: 'text',
      required: true,
      scope: 'item',
      section: 'meta',
    },
    {
      key: 'meta.note',
      label: 'Note',
      type: 'text',
      required: false,
      scope: 'item',
      section: 'meta',
    },
  ],
};

describe('SerialInspectionReactiveFormComponent — autosave', () => {
  let fixture: ComponentFixture<SerialInspectionReactiveFormComponent>;
  let saves: Array<{ id: string; data: Record<string, unknown> }>;

  const setup = (isReadOnly = false) => {
    saves = [];
    fixture = TestBed.createComponent(SerialInspectionReactiveFormComponent);
    fixture.componentRef.setInput('definition', DEFINITION);
    fixture.componentRef.setInput('initialData', {
      meta: { name: 'A', note: '' },
    });
    fixture.componentRef.setInput('recordId', 'sn-1');
    fixture.componentRef.setInput('isReadOnly', isReadOnly);
    fixture.componentRef.setInput(
      'autosaveFn',
      async (id: string, data: Record<string, unknown>) => {
        saves.push({ id, data });
      },
    );
    fixture.detectChanges();
    return fixture.componentInstance;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    TestBed.configureTestingModule({
      imports: [SerialInspectionReactiveFormComponent],
    });
  });
  afterEach(() => jest.useRealTimers());

  it('saves a draft to its record after the typing pause, even when a required field is empty', async () => {
    const c = setup();
    c.formGroup.get('meta_name')!.setValue(''); // invalid (required) — still a draft
    c.formGroup.get('meta_note')!.setValue('half done');
    jest.advanceTimersByTime(699);
    expect(saves).toHaveLength(0);
    jest.advanceTimersByTime(1);
    await Promise.resolve();
    expect(saves).toHaveLength(1);
    expect(saves[0]!.id).toBe('sn-1');
    expect(saves[0]!.data).toEqual({ meta: { name: '', note: 'half done' } });
  });

  it('saves immediately when a field is committed (change / leaving the field)', async () => {
    const c = setup();
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    c.formGroup.get('meta_note')!.setValue('picked');
    form.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    expect(saves).toHaveLength(1);
    expect(saves[0]!.data).toEqual({ meta: { name: 'A', note: 'picked' } });

    c.formGroup.get('meta_note')!.setValue('typed');
    form.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await Promise.resolve();
    expect(saves).toHaveLength(2);
  });

  it('does not double-save when focus moves to the Save button', async () => {
    const c = setup();
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    const submit = form.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    c.formGroup.get('meta_note')!.setValue('about to save');
    form.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: submit }),
    );
    await Promise.resolve();
    expect(saves).toHaveLength(0);
  });

  it('saves pending edits when the tab is hidden', async () => {
    const c = setup();
    c.formGroup.get('meta_note')!.setValue('leaving');
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    await Promise.resolve();
    expect(saves).toHaveLength(1);
  });

  it('does not save when nothing changed from the last saved state', async () => {
    const c = setup();
    c.formGroup.get('meta_note')!.setValue('x');
    c.formGroup.get('meta_note')!.setValue(''); // back to the original
    jest.advanceTimersByTime(2000);
    await Promise.resolve();
    expect(saves).toHaveLength(0);
  });

  it('flushes the outgoing record to ITS id when the host switches serial', async () => {
    const c = setup();
    c.formGroup.get('meta_note')!.setValue('for sn-1');
    fixture.componentRef.setInput('recordId', 'sn-2');
    fixture.componentRef.setInput('initialData', {
      meta: { name: 'B', note: '' },
    });
    fixture.detectChanges();
    await Promise.resolve();
    expect(saves).toHaveLength(1);
    expect(saves[0]!.id).toBe('sn-1');
    expect(saves[0]!.data).toEqual({ meta: { name: 'A', note: 'for sn-1' } });
    // The new record is seeded and clean — no stray save for it.
    jest.advanceTimersByTime(3000);
    await Promise.resolve();
    expect(saves).toHaveLength(1);
    expect(c.formGroup.get('meta_name')!.value).toBe('B');
  });

  it('flushes pending edits on destroy', async () => {
    const c = setup();
    c.formGroup.get('meta_note')!.setValue('typed then closed');
    fixture.destroy();
    await Promise.resolve();
    expect(saves).toHaveLength(1);
    expect(saves[0]!.data).toEqual({
      meta: { name: 'A', note: 'typed then closed' },
    });
    expect(c).toBeTruthy();
  });

  it('never autosaves a read-only form', async () => {
    const c = setup(true);
    c.formGroup.get('meta_note')!.setValue('nope');
    jest.advanceTimersByTime(3000);
    fixture.destroy();
    await Promise.resolve();
    expect(saves).toHaveLength(0);
  });
});
