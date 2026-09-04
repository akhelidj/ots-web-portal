import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { signal } from '@angular/core';
import { environment } from '@app-env/environment';
import { APP_ROLES } from '@portal/core/constants/app.constants';
import {
  DataHydrationContext,
  DataHydrationSource,
} from '@portal/core/offline/services/data-hydration.token';

export interface AdminTemplateItem {
  id: string;
  templateKey: string;
  templateVersion: number;
  status: 'ACTIVE' | 'DEPRECATED';
  changeNote: string;
  createdAt: string;
  createdById: string;
  /** The row's CURRENT stored definition (null for a never-defined template). Carried on the
   *  list so the row action can read DEFINED-vs-undefined via `isTemplateDefined` — the SAME
   *  predicate the Define page's read-only recap keys off, so the two can never disagree. */
  definitionJson: StoredDefinition | null;
}

/** One extracted `{{token}}` from `GET /templates/:id/tokens`. Mirrors the API's
 *  ExtractedToken (no shared DTO package — see ADR-0008). */
export interface ExtractedToken {
  token: string;
  cell: string;
  row: number;
}

/** Portal-side mirror of the API's ops field type. `date` is renderable (Phase D 2b). */
export type OpsFieldType = 'text' | 'number' | 'boolean' | 'select' | 'date';

/**
 * A field's SYSTEM role (mirrors the API's FieldRole). Roles split by scope: the six
 * HEADER roles derive their value from a computed token (inspector→inspectedBy,
 * supervisor→approvedBy, inspectionDate→reportDate, customer→customerName,
 * reportNumber→reportNumber, poNumber→poNumber); the single ITEM role `serialNumber`
 * marks the serial's own token — the one sent as `region.marker`. At most one field per
 * role in a definition.
 */
export type FieldRole =
  | 'inspector'
  | 'supervisor'
  | 'inspectionDate'
  | 'customer'
  | 'reportNumber'
  | 'poNumber'
  | 'serialNumber';

/** One ops-described field for `PUT /templates/:id/definition`. Mirrors OpsTokenField. */
export interface OpsTokenField {
  token: string;
  label: string;
  type: OpsFieldType;
  required: boolean;
  scope: 'header' | 'item';
  /** Optional system role — a header role (derived value) or the item role `serialNumber`. */
  role?: FieldRole;
  section?: string;
  options?: string[];
}

/** The child report types a rework rule may upsert. Mirrors the API's ChildReportType. */
export type ChildReportTypeChoice = 'REWORK' | 'SCRAP' | 'HOLD';

/** The ops-authorable slice of an `upsertChildReport` rule (slice A) — only the shape the
 *  server's ReworkRulesInterpreter consumes. Mirrors the API's OpsReworkRule. `op`/`action`/
 *  `membership` are fixed server-side and NOT authored here. */
export interface OpsReworkRule {
  /** The field key (token-derived) whose per-serial value triggers the rule. */
  field: string;
  /** The value that field must strictly equal for a serial to match. */
  equals: string;
  /** The child report type to upsert. */
  childType: ChildReportTypeChoice;
  /** Optional suffix appended to the parent reportNumber for the child. */
  reportNumberSuffix?: string;
}

/** The request body for `PUT /templates/:id/definition`. Mirrors the API's
 *  DefineTemplateDto — the front/back HTTP contract, duplicated by design. The UI does
 *  NOT author `computed`/`disposition`/transforms; the server gate is the sole authority
 *  on validity, and this ships only what the describe screen collects. */
export interface DefineTemplateDto {
  displayName?: string;
  /** The repeating region — present for a REGION template, OMITTED for a FLAT one (the
   *  server then builds `regions: []`). Mirrors the API's optional `region`. */
  region?: {
    id: string;
    label?: string;
    marker: string;
  };
  fields: OpsTokenField[];
  /** Optional single rework trigger (slice A). Omitted → no rule. Mirrors the API's
   *  optional `reworkRule`. */
  reworkRule?: OpsReworkRule;
}

/**
 * Portal-side mirror of ONE stored field in `Template.definitionJson` (the API's
 * CandidateDefinition — no shared DTO package, ADR-0008). `key` is the token stripped of its
 * braces (e.g. `poNumber`); the `serialNumber`-roled field is kept here (it marks the
 * serial's own token). Only the slice the read-only recap needs is typed.
 */
export interface StoredDefinitionField {
  key: string;
  label: string;
  type: OpsFieldType;
  required: boolean;
  scope: 'header' | 'item';
  role?: FieldRole;
  section?: string;
  options?: string[];
}

/** Portal-side mirror of one stored export entry — the recap reads it only to recover the
 *  exact serial-marker token (`source: 'rowSerial'`), which is not on the field itself. */
export interface StoredExportEntry {
  token: string;
  field?: string;
  source?: string;
}

/**
 * Portal-side mirror of the stored `Template.definitionJson` — the authoritative CURRENT
 * definition. Only the slice the read-only recap hydrates from is typed here; the engine
 * carries more (transforms, disposition, computed export). The rework rule is read back from
 * `rules[0]` in the interpreter's stored shape.
 */
export interface StoredDefinition {
  displayName?: string;
  regions?: { id: string; label?: string; chunkSize?: number | null }[];
  fields: StoredDefinitionField[];
  export?: {
    global?: StoredExportEntry[];
    regions?: Record<string, StoredExportEntry[]>;
  };
  rules?: unknown[];
}

/**
 * DEFINED-STATE detection — the single source of truth for "is this template defined?".
 * A template counts as defined once its stored `definitionJson` carries at least one field
 * (the engine rejects an empty definition at the gate, so an empty/garbled `{}` reads as
 * undefined). Both the templates-list row action (View vs Define) and the Define page's
 * read-only recap branch call THIS, so the label and the recap can never drift apart.
 */
export function isTemplateDefined(
  def: StoredDefinition | null | undefined,
): def is StoredDefinition {
  return !!def && Array.isArray(def.fields) && def.fields.length > 0;
}

/** The `GET /templates/:id/definition` payload — the light read the Define page opens with.
 *  `definitionJson` is null for a never-defined template, the stored definition once set. */
export interface TemplateDefinitionDetail {
  templateKey: string;
  templateVersion: number;
  status: 'ACTIVE' | 'DEPRECATED';
  definitionJson: StoredDefinition | null;
}

@Injectable({
  providedIn: 'root',
})
export class AdminTemplatesService implements DataHydrationSource {
  private http = inject(HttpClient);

  public readonly templates = signal<AdminTemplateItem[]>([]);
  public readonly resourceKey = 'admin-templates';

  public canHydrate(context: DataHydrationContext): boolean {
    return context.profile?.role === APP_ROLES.ADMIN;
  }

  public async pullAllAndCache(): Promise<void> {
    try {
      const templates = await firstValueFrom(
        this.http.get<AdminTemplateItem[]>(`${environment.apiUrl}/templates`),
      );
      this.templates.set(templates);
    } catch (e) {
      console.error('Failed to fetch templates:', e);
      throw e;
    }
  }

  public async fetchAll(): Promise<void> {
    await this.pullAllAndCache();
  }

  public async createTemplate(
    templateKey: string,
    changeNote: string,
    file: File,
  ): Promise<void> {
    const formData = new FormData();
    formData.append('templateKey', templateKey);
    formData.append('changeNote', changeNote);
    formData.append('file', file);

    await firstValueFrom(
      this.http.post(`${environment.apiUrl}/templates`, formData),
    );
    await this.fetchAll();
  }

  /** Read-only: the template's CURRENT stored definition (or null for a never-defined
   *  template). The Define page hits this on open to decide defined-vs-undefined and, when
   *  defined, hydrate the read-only recap from the authoritative stored shape — NOT from
   *  re-extracted tokens (fidelity: show what was saved, not what the workbook holds now). */
  public async getDefinition(id: string): Promise<TemplateDefinitionDetail> {
    return firstValueFrom(
      this.http.get<TemplateDefinitionDetail>(
        `${environment.apiUrl}/templates/${id}/definition`,
      ),
    );
  }

  /** Read-only: the workbook's extracted tokens, for the describe screen. */
  public async getTokens(id: string): Promise<ExtractedToken[]> {
    return firstValueFrom(
      this.http.get<ExtractedToken[]>(
        `${environment.apiUrl}/templates/${id}/tokens`,
      ),
    );
  }

  /** Submit the ops-authored description. Resolves on 200 (definition written);
   *  rejects with the server's per-check reason on a 4xx gate rejection. */
  public async defineTemplate(
    id: string,
    dto: DefineTemplateDto,
  ): Promise<unknown> {
    return firstValueFrom(
      this.http.put(`${environment.apiUrl}/templates/${id}/definition`, dto),
    );
  }

  public async deprecateTemplate(id: string): Promise<void> {
    await firstValueFrom(
      this.http.patch(`${environment.apiUrl}/templates/${id}/deprecate`, {}),
    );
    await this.fetchAll();
  }
}
