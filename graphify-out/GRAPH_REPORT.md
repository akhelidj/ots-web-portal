# Graph Report - .  (2026-08-01)

## Corpus Check
- 325 files · ~122,364 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2035 nodes · 3580 edges · 214 communities (117 shown, 97 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 70 edges (avg confidence: 0.84)
- Token cost: 388,294 input · 0 output

## Community Hubs (Navigation)
- FilesService
- AppRole
- RevisionService (single source of truth)
- app.routes.ts
- types.ts
- AuthService
- inspection-report-detail.component.ts
- template-upload.integration.spec.ts
- InspectionReportDetailComponent
- nx.json
- ConnectivityService
- SystemNoticeService
- app.module.ts
- ChildReportDetailComponent
- PrismaService
- LocalUser
- export.integration.spec.ts
- export.service.ts
- InspectionReportsService
- inspection-report-list.component.ts
- compilerOptions
- UsersService
- customers.controller.ts
- CustomersService
- RevisionService
- scripts
- prisma.service.ts
- SerialInspectionReactiveFormComponent
- inspection-reports.controller.ts
- AuthenticatedRequest
- compilerOptions
- dependencies
- OutboxItem
- InspectionReportWorkflowService
- LocalCustomer
- child-report-detail.component.ts
- layout/index.ts
- compilerOptions
- compilerOptions
- LocalSerialNumber
- SerialNumbersController
- compilerOptions
- Offline-Sync Confirmed Risks Index
- AdminCustomersComponent
- LocalTransitionLog
- devDependencies
- targets
- Inspection Report Lifecycle Trace
- Revision Snapshot on Approval/Reopen
- AdminCustomersService
- ChildReportsService
- ShellComponent
- Phase 3 any-purge Inventory
- T0.2 Database Operational Baseline Plan
- DataHydrationService
- AdminTemplatesComponent
- InspectionReportReworkStatusComponent
- portal/tsconfig.app.json
- api/src/main.ts
- jwt.strategy.ts
- CreateApprovalBatchDto
- options
- SerialNumberLocalRepo
- copy-workspace-modules
- prune-lockfile
- test
- ReturnBatchDto
- Outbox Pattern (write-local-first, enqueue mutation)
- T0.3 Authentication Foundation
- T0.1 Baseline Hardening Plan
- LocalInspectionApprovalBatch
- development
- api/tsconfig.json
- F0.1.3 Offline Session & Auth
- .onShellScroll()
- targets
- Admin Inspection Templates Template
- SettingsComponent
- options
- F0.2.2 Serial Numbers MVP
- portal/project.json
- options
- test
- http-error.utils.ts
- SyncOrchestratorService
- InspectionReportApprovalBatchesComponent
- AdminTemplatesService
- Customer role workspace (view reports,
- .prettierrc.json
- serve
- seed.ts
- Milestones
- F0.1.4 Admin User Management MVP
- build
- OutboxService
- ChangePasswordComponent
- InspectionReportAddSerialPanelComponent
- InspectionReportHeaderComponent
- global-setup.ts
- OTS Monorepo
- SyncOrchestratorService
- package.json
- ngsw-config.json
- development
- production
- CreateInspectionReportComponent
- InspectionReportBannersComponent
- status-badge.component.ts
- sync-portal-version.mjs
- test-integration
- OTS Brand Mark
- test-nested.js
- check-duplicates.ts
- webpack.config.js
- ShellComponent
- schema.prisma
- OTS App Icon (512x512)
- Authentication Feature Area
- Report Status Workflow / Transitions
- NxWelcome
- tailwind.config.js
- @angular/build
- @angular/cli
- @angular/compiler
- @angular/compiler-cli
- @angular/core
- @angular-devkit/build-angular
- @angular-devkit/core
- @angular-devkit/schematics
- angular-eslint
- @angular/forms
- @angular/language-service
- @angular/platform-browser-dynamic
- @angular/router
- autoprefixer
- bcrypt
- class-transformer
- class-validator
- dotenv
- eslint
- eslint-config-prettier
- @eslint/js
- exceljs
- form-data
- jest
- jest-environment-jsdom
- @nestjs/config
- @nestjs/passport
- @nestjs/schematics
- @nestjs/testing
- @nx/angular
- @nx/eslint-plugin
- @nx/jest
- @nx/js
- @nx/nest
- @nx/node
- @nx/web
- passport
- passport-jwt
- reflect-metadata
- rxjs
- @types/jszip
- nx
- postcss
- prettier
- prisma
- @schematics/angular
- @swc/core
- @swc/helpers
- @swc/jest
- @swc-node/register
- tailwindcss
- ts-node
- tslib
- @types/bcrypt
- @types/jest
- @types/multer
- @types/node
- @types/passport-jwt
- typescript
- typescript-eslint
- @typescript-eslint/utils
- webpack-cli
- Approval Batch Entity
- Rework Child Report Workflow
- drill-pipe-fields.ts
- Admin Users template
- System notices (update modal, offline/online
- environment.prod.ts
- app-root mount point (PWA entry)
- test-setup.ts
- TEST DATABASE URL
- DefaultDenyGuard (global JWT auth)
- T0.2 Decisions
- App Root Shell Template
- Register Inventory (Add Serials) Panel
- Report Banners Section Template
- Report Header (Condensing) Section Template
- KPI Overview (Disposition Stats) Section

## God Nodes (most connected - your core abstractions)
1. `InspectionReportDetailComponent` - 78 edges
2. `PrismaService` - 57 edges
3. `AuthenticatedRequest` - 54 edges
4. `InspectionReportsService` - 39 edges
5. `ChildReportDetailComponent` - 38 edges
6. `LocalSerialNumber` - 36 edges
7. `AppRole` - 35 edges
8. `Roles()` - 31 edges
9. `SessionService` - 30 edges
10. `LocalInspectionReport` - 28 edges

## Surprising Connections (you probably didn't know these)
- `InspectionReportDetailComponent` --references--> `SerialInspectionReactiveFormComponent`  [EXTRACTED]
  portal/src/app/features/inspections/components/inspection-report-detail/inspection-report-detail.component.ts → portal/src/app/features/inspections/components/child-report-detail/child-report-detail.component.html
- `RevisionService (single source of truth)` --conceptually_related_to--> `RevisionService / Revision-Snapshot Engine`  [INFERRED]
  docs/architecture/revision-snapshot-engine.md → CLAUDE.md
- `Inspection Reports API` --conceptually_related_to--> `Hardcoded templateKey DRILL_PIPE_REPORT constraint`  [INFERRED]
  docs/api/inspection-reports-endpoints.md → CLAUDE.md
- `ChildReportDetailComponent` --semantically_similar_to--> `InspectionReportDetailComponent`  [INFERRED] [semantically similar]
  portal/src/app/features/inspections/components/child-report-detail/child-report-detail.component.ts → portal/src/app/features/inspections/components/inspection-report-detail/inspection-report-detail.component.ts
- `ChildReportDetailComponent` --references--> `SerialInspectionReactiveFormComponent`  [EXTRACTED]
  portal/src/app/features/inspections/components/child-report-detail/child-report-detail.component.ts → portal/src/app/features/inspections/components/child-report-detail/child-report-detail.component.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Offline-First Sync Stack** — docs_architecture_pwa_offline_network_state_of_play_db_service, docs_architecture_pwa_offline_network_state_of_play_outbox_service, docs_architecture_pwa_offline_network_state_of_play_sync_orchestrator, docs_tickets_f0_1_2_outbox_pattern [EXTRACTED 0.85]
- **T0.2 Prisma/Postgres Data Layer Baseline** — docs_tickets_t0_2_01_plan_prisma_postgres, docs_tickets_t0_2_01_plan_prisma_service, docs_tickets_t0_2_01_plan_wsl_docker_named_volume, docs_tickets_t0_2_03_changes_schema_prisma [EXTRACTED 0.75]
- **Auth feature templates (login, change-password, settings)** — portal_src_app_features_auth_components_login_login_component_template, portal_src_app_features_auth_components_change_password_change_password_component_template [EXTRACTED 1.00]
- **Role-specific workspaces sharing inspection report list** — portal_src_app_features_workspaces_customer_customer_workspace_component_concept, portal_src_app_features_workspaces_receiver_receiver_workspace_component_concept, portal_src_app_features_workspaces_supervisor_supervisor_workspace_component_concept [INFERRED 0.85]
- **Template versioning, binding and export lifecycle** — docs_architecture_template_versioning_template_entity, docs_architecture_inspection_report_template_binding_binding, docs_architecture_export_mapping_drill_pipe_v1_mapping, docs_architecture_revision_snapshot_engine_engine [INFERRED 0.85]
- **Symmetric frontend/backend PENDING_APPROVAL gating** — docs_architecture_inspection_form_schema_reportvalidationservice, docs_architecture_inspection_form_schema_workflowservice, claudemd_pending_approval_gate, docs_api_dispositions_validation_failed [INFERRED 0.85]
- **Offline-first outbox sync and temporal-ID remap flow** — claudemd_offline_sync_core, claudemd_syncdispatcher, claudemd_temporal_id_remap, docs_api_serial_numbers_endpoints_clientref, docs_api_serial_number_inspection_outbox [INFERRED 0.85]
- **Three Confirmed Offline-Sync Risks** — docs_internal_sync_risks_conflict_terminal, docs_internal_sync_risks_clearconflicts_overdelete, docs_internal_sync_risks_idempotency_not_sent [EXTRACTED 1.00]
- **Offline-First Write Pipeline** — docs_tickets_f0_1_2_outbox_pattern, docs_internal_report_lifecycle_trace_temporal_id_remap, docs_tickets_f0_1_7_sync_orchestrator, docs_tickets_f0_2_sync_dispatcher [INFERRED 0.85]
- **Revision Snapshot Engine Lineage** — docs_milestones_t0_5_3_revision_snapshot_engine, docs_tickets_t0_4_workflow_transition_engine_reopen_snapshot, docs_internal_report_lifecycle_trace_revision_snapshot, docs_internal_phase3_any_purge_inventory_snapshot_type [INFERRED 0.75]
- **Page Layout Composition Slot Family** — portal_src_app_shared_components_layout_page_layout_page_layout_component_pagelayoutcomponent, portal_src_app_shared_components_layout_page_identity_page_identity_component_pageidentitycomponent, portal_src_app_shared_components_layout_page_actions_page_actions_component_pageactionscomponent, portal_src_app_shared_components_layout_page_summary_page_summary_component_pagesummarycomponent, portal_src_app_shared_components_layout_page_workspace_page_workspace_component_pageworkspacecomponent, portal_src_app_shared_components_layout_page_secondary_panel_page_secondary_panel_component_pagesecondarypanelcomponent [INFERRED 0.75]
- **Inspection Report Detail Section Components** — portal_src_app_features_inspections_components_inspection_report_detail_inspection_report_detail_component_inspectionreportdetailcomponent, portal_src_app_features_inspections_components_inspection_report_detail_sections_inspection_report_header_component_inspectionreportheadercomponent, portal_src_app_features_inspections_components_inspection_report_detail_sections_inspection_report_serials_table_inspection_report_serials_table_component_inspectionreportserialstablecomponent, portal_src_app_features_inspections_components_inspection_report_detail_sections_inspection_report_transition_actions_component_inspectionreporttransitionactionscomponent [INFERRED 0.75]

## Communities (214 total, 97 thin omitted)

### Community 0 - "FilesService"
Cohesion: 0.06
Nodes (24): ChildReportsController, Body, Controller, Get, Param, Patch, Post, Query (+16 more)

### Community 1 - "AppRole"
Cohesion: 0.07
Nodes (38): AppRole, HelpComponent, Component, HelpAccountSettingsSectionComponent, Component, Input, HelpAdminOperationsSectionComponent, Component (+30 more)

### Community 2 - "RevisionService (single source of truth)"
Cohesion: 0.05
Nodes (51): Offline-Sync Core Subsystem, Optimistic Concurrency Pattern, OTS Web Portal Monorepo Reference, PENDING_APPROVAL Transition Gate, PrismaService (single DB gateway), RevisionService / Revision-Snapshot Engine, SyncDispatcher, SyncOrchestrator (+43 more)

### Community 3 - "app.routes.ts"
Cohesion: 0.07
Nodes (23): appRoutes, authGuard(), mustChangePasswordGuard(), roleGuard(), RoleLandingService, Injectable, SessionService, Injectable (+15 more)

### Community 4 - "types.ts"
Cohesion: 0.11
Nodes (16): LocalBatchSerialNumber, LocalInspectionReport, MetaRecord, OutboxStatus, SerialApprovalStatus, BatchSerialNumberLocalRepo, Injectable, InspectionReportLocalRepo (+8 more)

### Community 5 - "AuthService"
Cohesion: 0.08
Nodes (20): AuthController, Body, Controller, Get, Post, Req, UseGuards, AuthService (+12 more)

### Community 6 - "inspection-report-detail.component.ts"
Cohesion: 0.09
Nodes (30): RFC-5987, BATCH_STATUSES, BatchStatus, CHILD_REPORT_TYPES, ENTITY_TYPES, EntityType, REPORT_STATUSES, ReportStatus (+22 more)

### Community 7 - "template-upload.integration.spec.ts"
Cohesion: 0.08
Nodes (21): TemplateController, Body, Controller, Get, Param, Patch, Post, Req (+13 more)

### Community 8 - "InspectionReportDetailComponent"
Cohesion: 0.06
Nodes (11): InspectionReportDetailComponent, Component, ViewChild, InspectionReportAddSerialPanelComponent, InspectionReportApprovalBatchesComponent, InspectionReportBannersComponent, InspectionReportHeaderComponent, InspectionReportKpiOverviewComponent (+3 more)

### Community 9 - "nx.json"
Cohesion: 0.05
Nodes (37): cache, dependsOn, inputs, defaultBase, generators, @nx/angular:application, @nx/angular:library, @nx/nest:application (+29 more)

### Community 10 - "ConnectivityService"
Cohesion: 0.14
Nodes (13): jwtInterceptor(), UserProfile, apiErrorInterceptor(), ConnectivityService, Injectable, HydrationOptions, DATA_HYDRATION_SOURCES, DataHydrationContext (+5 more)

### Community 11 - "SystemNoticeService"
Cohesion: 0.08
Nodes (15): App, appConfig, Component, NoticeType, SystemNotice, SystemNoticeService, Injectable, SystemNoticeComponent (+7 more)

### Community 12 - "app.module.ts"
Cohesion: 0.10
Nodes (20): AppController, Controller, Get, AppService, Injectable, AuthModule, Module, DefaultDenyGuard (+12 more)

### Community 13 - "ChildReportDetailComponent"
Cohesion: 0.09
Nodes (4): getChildReportUiState(), ChildReportDetailComponent, Component, SerialInspectionReactiveFormComponent

### Community 14 - "PrismaService"
Cohesion: 0.09
Nodes (11): ValidatedUser, NOTE: this path is currently unreachable from any route — the workflow, CreateInspectionReportDto, IsNotEmpty, IsString, InspectionReportsService, Injectable, PrismaService (+3 more)

### Community 15 - "LocalUser"
Cohesion: 0.10
Nodes (8): LocalUser, Injectable, UserLocalRepo, AdminUsersComponent, Component, ViewChild, AdminUsersService, Injectable

### Community 16 - "export.integration.spec.ts"
Cohesion: 0.17
Nodes (23): seedCrsnCase(), allCellTexts(), approveWithSerials(), loadSheet(), newSeededDraft(), readCellText(), rowTextsFor(), serialRowOrder() (+15 more)

### Community 17 - "export.service.ts"
Cohesion: 0.11
Nodes (21): Snapshot, ExportController, Controller, Get, Param, Query, Req, Res (+13 more)

### Community 19 - "inspection-report-list.component.ts"
Cohesion: 0.10
Nodes (13): ReportValidationService, Injectable, ValidationIssue, ValidationResult, InspectionReportTransitionActionComponent, SelectedTransition, TransitionChoice, Component (+5 more)

### Community 20 - "compilerOptions"
Cohesion: 0.07
Nodes (27): dom, es2020, node_modules, portal/src/app/*, portal/src/environments/*, tmp, compileOnSave, compilerOptions (+19 more)

### Community 21 - "UsersService"
Cohesion: 0.12
Nodes (14): Body, Controller, Delete, Get, Param, Patch, Post, Req (+6 more)

### Community 22 - "customers.controller.ts"
Cohesion: 0.12
Nodes (17): CustomersModule, Module, CustomerAuditAction, CreateCustomerDto, IsBoolean, IsEmail, IsOptional, IsString (+9 more)

### Community 23 - "CustomersService"
Cohesion: 0.14
Nodes (12): CustomersController, Body, Controller, Delete, Get, Param, Patch, Post (+4 more)

### Community 24 - "RevisionService"
Cohesion: 0.11
Nodes (12): RevisionService, Injectable, ChildReportWorkflowController, TransitionRequestDto, Body, Controller, Get, Param (+4 more)

### Community 25 - "scripts"
Cohesion: 0.08
Nodes (24): scripts, build:api, build:deploy, build:portal, db:generate, db:migrate, db:reset, db:seed (+16 more)

### Community 26 - "prisma.service.ts"
Cohesion: 0.16
Nodes (12): ChildSnapshot, InspectionData, SnapshotEquipment, SnapshotInspectionMethod, SnapshotTransitionLog, AuthUser, DRILL_PIPE_REQUIRED_KEYS, allowedTransitionMap (+4 more)

### Community 27 - "SerialInspectionReactiveFormComponent"
Cohesion: 0.14
Nodes (9): SerialInspectionReactiveFormComponent, Component, Input, Output, DRILL_PIPE_V1_SCHEMA, FieldInputType, FieldSchema, FormSchema (+1 more)

### Community 28 - "inspection-reports.controller.ts"
Cohesion: 0.14
Nodes (11): RolesGuard, Injectable, ApproveBatchDto, IsArray, IsInt, IsOptional, IsString, Min (+3 more)

### Community 29 - "AuthenticatedRequest"
Cohesion: 0.29
Nodes (12): AuthenticatedRequest, Roles(), InspectionReportsController, Body, Controller, Get, Param, Patch (+4 more)

### Community 30 - "compilerOptions"
Cohesion: 0.09
Nodes (21): angularCompilerOptions, enableI18nLegacyMessageIdFormat, strictInjectionParameters, strictInputAccessModifiers, strictTemplates, compilerOptions, emitDecoratorMetadata, isolatedModules (+13 more)

### Community 31 - "dependencies"
Cohesion: 0.10
Nodes (21): @angular/animations, @angular/common, @angular/platform-browser, @angular/service-worker, axios, @nestjs/common, @nestjs/core, @nestjs/jwt (+13 more)

### Community 32 - "OutboxItem"
Cohesion: 0.15
Nodes (4): OutboxItem, OutboxLocalRepo, Injectable, FakeOutboxLocalRepo

### Community 33 - "InspectionReportWorkflowService"
Cohesion: 0.15
Nodes (10): InspectionReportWorkflowController, TransitionRequestDto, Body, Controller, Get, Param, Post, Req (+2 more)

### Community 34 - "LocalCustomer"
Cohesion: 0.14
Nodes (6): LocalCustomer, CustomerLocalRepo, Injectable, Injectable, UserPreferences, UserPreferencesService

### Community 35 - "child-report-detail.component.ts"
Cohesion: 0.16
Nodes (11): CHILD_REPORT_STATUSES, ChildReportStatus, ChildReportType, LocalChildReport, ChildReportLocalRepo, Injectable, ActionState, Banner (+3 more)

### Community 36 - "layout/index.ts"
Cohesion: 0.11
Nodes (12): PageActionsComponent, Component, PageIdentityComponent, Component, PageLayoutComponent, Component, PageSecondaryPanelComponent, Component (+4 more)

### Community 37 - "compilerOptions"
Cohesion: 0.11
Nodes (17): compilerOptions, module, moduleResolution, outDir, target, types, extends, files (+9 more)

### Community 38 - "compilerOptions"
Cohesion: 0.12
Nodes (16): compilerOptions, emitDecoratorMetadata, experimentalDecorators, module, moduleResolution, outDir, target, types (+8 more)

### Community 39 - "LocalSerialNumber"
Cohesion: 0.21
Nodes (5): LocalSerialNumber, InspectionReportSerialsTableComponent, Component, Input, Output

### Community 41 - "SerialNumbersController"
Cohesion: 0.18
Nodes (10): SerialNumbersController, Body, Controller, Delete, Get, Param, Patch, Post (+2 more)

### Community 42 - "compilerOptions"
Cohesion: 0.13
Nodes (14): compilerOptions, module, moduleResolution, outDir, types, extends, include, jest (+6 more)

### Community 43 - "Offline-Sync Confirmed Risks Index"
Cohesion: 0.15
Nodes (15): Risk #2 clearConflicts Over-Deletes, emiResult to disposition Membership Fix, AllExceptionsFilter Flattens Structured Bodies, final.disposition Semantic Orphan, Risk #3 Idempotency Key Not Sent, Offline-Sync Confirmed Risks Index, OutboxItem Interface, F0.2.4 Inspection Data Entry MVP (+7 more)

### Community 45 - "LocalTransitionLog"
Cohesion: 0.20
Nodes (6): LocalTransitionLog, TransitionLogLocalRepo, Injectable, InspectionReportTransitionHistoryComponent, Component, Input

### Community 46 - "devDependencies"
Cohesion: 0.15
Nodes (13): dotenv-cli, fake-indexeddb, jest-preset-angular, @nx/eslint, @nx/webpack, @nx/workspace, devDependencies, dotenv-cli (+5 more)

### Community 47 - "targets"
Cohesion: 0.17
Nodes (11): name, projectType, dependsOn, executor, $schema, sourceRoot, tags, targets (+3 more)

### Community 48 - "Inspection Report Lifecycle Trace"
Cohesion: 0.20
Nodes (12): F0.2 Backend Surface Audit, InspectionReportWorkflowController, Missing GET/PATCH Endpoints, Inspection Report Lifecycle Trace, Optimistic Concurrency (read-compare-guarded-write), Temporal-ID Remapping, Atomic Temporal ID Remapping Architecture, F0.2.1 Inspection Report Creation MVP (+4 more)

### Community 49 - "Revision Snapshot on Approval/Reopen"
Cohesion: 0.18
Nodes (12): Snapshot / InspectionData Authored Types, PENDING_APPROVAL Validation Gate, Revision Snapshot on Approval/Reopen, T0.5.3 Revision Snapshot Engine, pendingTransitionToStatus Optimistic State, F0.2.3 Workflow Transitions UI, F0.2.5 Disposition + Pending Approval Gating, VALIDATION_FAILED 400 on Transition (+4 more)

### Community 52 - "ShellComponent"
Cohesion: 0.18
Nodes (3): NavigationService, ShellComponent, Component

### Community 53 - "Phase 3 any-purge Inventory"
Cohesion: 0.20
Nodes (11): Phase 3 any-purge Inventory, AuthenticatedRequest Type, ExcelJS/JSZip Buffer Cast Friction, @types/multer Not Installed, no-explicit-any ESLint Rule, portal spec-tsconfig moduleResolution Artifact, TypeScript strict Flag Enablement, Phase 3 Strict-Flag + ESLint Fallout Inventory (+3 more)

### Community 54 - "T0.2 Database Operational Baseline Plan"
Cohesion: 0.18
Nodes (11): AuditLog, T0.2 Database Operational Baseline Plan, Prisma + Postgres Stack, PrismaService / PrismaModule, provision-tenant.ts Script, Tenant Isolation (tenantId scoping), WSL Docker Named Volume Approach, inspectionData as JSONB (template flexibility) (+3 more)

### Community 56 - "AdminTemplatesComponent"
Cohesion: 0.16
Nodes (5): LoginComponent, Component, ViewChild, AdminTemplatesComponent, Component

### Community 57 - "InspectionReportReworkStatusComponent"
Cohesion: 0.22
Nodes (4): InspectionReportReworkStatusComponent, Component, Input, Output

### Community 58 - "portal/tsconfig.app.json"
Cohesion: 0.18
Nodes (10): compilerOptions, outDir, types, exclude, extends, include, src/**/*.spec.ts, src/**/*.test.ts (+2 more)

### Community 59 - "api/src/main.ts"
Cohesion: 0.22
Nodes (5): AppModule, Module, AllExceptionsFilter, NOTE: intentionally reads `.message`, NOT `.getResponse()` — the resulting, Catch

### Community 60 - "jwt.strategy.ts"
Cohesion: 0.24
Nodes (6): AuthenticatedUser, JwtPayload, JwtStrategy, basePayload, stubConfig, Injectable

### Community 61 - "CreateApprovalBatchDto"
Cohesion: 0.20
Nodes (8): CreateApprovalBatchDto, IsArray, IsInt, IsNotEmpty, IsOptional, IsString, Min, IsUUID

### Community 62 - "options"
Cohesion: 0.20
Nodes (10): options, assets, browser, inlineStyleLanguage, outputPath, serviceWorker, styles, tsConfig (+2 more)

### Community 64 - "copy-workspace-modules"
Cohesion: 0.22
Nodes (9): cache, dependsOn, executor, outputs, build, dependsOn, dependsOn, copy-workspace-modules (+1 more)

### Community 65 - "prune-lockfile"
Cohesion: 0.22
Nodes (9): options, buildTarget, cache, executor, options, outputs, prune-lockfile, {workspaceRoot}/dist/api/package.json (+1 more)

### Community 66 - "test"
Cohesion: 0.25
Nodes (9): jestConfig, passWithNoTests, runInBand, test, executor, options, options, outputs (+1 more)

### Community 67 - "ReturnBatchDto"
Cohesion: 0.22
Nodes (7): ReturnBatchDto, IsArray, IsInt, IsNotEmpty, IsOptional, IsString, Min

### Community 68 - "Outbox Pattern (write-local-first, enqueue mutation)"
Cohesion: 0.25
Nodes (9): ConnectivityService, DbService (IndexedDB), OutboxService, PWA Offline Network State of Play, SyncOrchestratorService, Outbox Drain (FIFO + dependency gating), Risk #1 CONFLICT is Terminal, Conflict Halting on 409 (+1 more)

### Community 69 - "T0.3 Authentication Foundation"
Cohesion: 0.22
Nodes (9): F0.1.6 Auth UI for Demo and Dev, POST /auth/change-password, MustChangePasswordGuard, SessionService (accessToken/refreshToken/session_profile), db:provision Command, T0.2/04 Validation, T0.3 Authentication Foundation, RefreshToken Model (DB-backed, revocable, hashed) (+1 more)

### Community 70 - "T0.1 Baseline Hardening Plan"
Cohesion: 0.22
Nodes (9): T0.1 Baseline Hardening Plan, Default-Deny Guard, Environment Variable Config Strategy, Node.js 20.19.3 Version Lock, T0.1 Decisions, No proxy.conf (CORS mirrors production), Node 20.19.3 Nx Angular Workaround, T0.1 Changes (+1 more)

### Community 71 - "LocalInspectionApprovalBatch"
Cohesion: 0.36
Nodes (3): LocalInspectionApprovalBatch, ApprovalBatchLocalRepo, Injectable

### Community 72 - "development"
Cohesion: 0.25
Nodes (8): configurations, development, production, args, buildTarget, buildTarget, configurations, --node-env=development

### Community 73 - "api/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, esModuleInterop, extends, files, include, ../tsconfig.base.json, references

### Community 74 - "F0.1.3 Offline Session & Auth"
Cohesion: 0.25
Nodes (8): DbService, IndexedDB Object Stores (inspection_reports/serial_numbers/outbox/meta), F0.1.2 Offline Runtime Foundation, In-Place Auth Placeholder (no sign-in route), IndexedDB Never Wiped on Logout, JWT localStorage Session (isAuthenticated derivation), F0.1.3 Offline Session & Auth Behavior, Default-Deny Global Guard + @Public

### Community 76 - "targets"
Cohesion: 0.25
Nodes (8): executor, configurations, continuous, defaultConfiguration, executor, targets, lint, serve

### Community 77 - "Admin Inspection Templates Template"
Cohesion: 0.25
Nodes (8): Offline / Connectivity State UI, Customer Entity, Offline Sync State (PENDING/CONFLICT/ERROR/SYNCED), Admin Customer Directory Template, Create Inspection Report Template, Serial Inspection Reactive Form Template, Inspection Template / Schema Entity, Admin Inspection Templates Template

### Community 79 - "options"
Cohesion: 0.29
Nodes (7): executor, options, args, command, cwd, build, --node-env=production

### Community 80 - "F0.2.2 Serial Numbers MVP"
Cohesion: 0.29
Nodes (7): Characterize Before Touching Behavior, Serial Edit-Forbidden Guard (approvalStatus casts), Serial clientRef Remap, Characterization Test Pattern (assertions designed to flip), Serial BULK_CREATE (clientRef/serialNumber), F0.2.2 Serial Numbers MVP, Serial Uniqueness Constraint (tenantId/inspectionReportId/serial)

### Community 81 - "portal/project.json"
Cohesion: 0.29
Nodes (6): name, prefix, projectType, $schema, sourceRoot, tags

### Community 82 - "options"
Cohesion: 0.29
Nodes (7): buildTarget, spa, staticFilePath, continuous, executor, options, serve-static

### Community 83 - "test"
Cohesion: 0.29
Nodes (7): jestConfig, passWithNoTests, test, executor, options, outputs, {workspaceRoot}/coverage/portal

### Community 84 - "http-error.utils.ts"
Cohesion: 0.43
Nodes (6): ErrorPayload, ErrorPayloadObject, extractBackendErrorMessage(), extractRecordMessages(), joinMessages(), withNormalizedHttpErrorMessage()

### Community 86 - "InspectionReportApprovalBatchesComponent"
Cohesion: 0.29
Nodes (4): InspectionReportApprovalBatchesComponent, Component, Input, Output

### Community 88 - "Customer role workspace (view reports,"
Cohesion: 0.43
Nodes (7): Customer role workspace (view reports, download docs), Customer Workspace template, Receiver role workspace (intake/setup queue), Receiver Workspace template, Supervisor role workspace (decision queue, active inspection), Supervisor Workspace template, Inspection Report List (shared queue component)

### Community 89 - ".prettierrc.json"
Cohesion: 0.29
Nodes (6): endOfLine, printWidth, semi, singleQuote, tabWidth, trailingComma

### Community 90 - "serve"
Cohesion: 0.33
Nodes (6): runBuildTargetDependencies, continuous, defaultConfiguration, executor, options, serve

### Community 91 - "seed.ts"
Cohesion: 0.53
Nodes (5): main(), prisma, provisionNobleCorporation(), provisionRolesForTenant(), provisionTenant()

### Community 92 - "Milestones"
Cohesion: 0.33
Nodes (6): Hardcoded DRILL_PIPE_REPORT templateKey, Template-Version Binding Lock-In, Milestones, T0.5.1 Template Management, T0.5.2 Template Binding, T0.5.4 PDF Generation Service

### Community 93 - "F0.1.4 Admin User Management MVP"
Cohesion: 0.33
Nodes (6): F0.1.4 Admin User Management MVP, Read-Through Cache, tempPasswordSubject One-Time Display, F0.1.5 Admin Customers MVP, Customer Prisma Model (soft-deactivation, version), CustomerLocalRepo

### Community 94 - "build"
Cohesion: 0.33
Nodes (6): configurations, defaultConfiguration, executor, outputs, build, {options.outputPath}

### Community 97 - "InspectionReportAddSerialPanelComponent"
Cohesion: 0.33
Nodes (4): InspectionReportAddSerialPanelComponent, Component, Input, Output

### Community 98 - "InspectionReportHeaderComponent"
Cohesion: 0.33
Nodes (4): InspectionReportHeaderComponent, Component, Input, Output

### Community 100 - "OTS Monorepo"
Cohesion: 0.50
Nodes (5): Postgres Service (Docker), Angular Portal, NestJS API, OTS Monorepo, Prisma ORM

### Community 101 - "SyncOrchestratorService"
Cohesion: 0.50
Nodes (5): Two Write Paths (online server-first / offline queue), IndexedDB Per-Tenant Partitioning (ots_{tenantId}), Stale-While-Revalidate (pullAllAndCache), SyncOrchestratorService, F0.1.7 Tenant Isolation & Online Revalidation

### Community 102 - "package.json"
Cohesion: 0.40
Nodes (4): license, name, private, version

### Community 103 - "ngsw-config.json"
Cohesion: 0.40
Nodes (4): assetGroups, dataGroups, index, $schema

### Community 104 - "development"
Cohesion: 0.40
Nodes (5): development, buildTarget, extractLicenses, optimization, sourceMap

### Community 105 - "production"
Cohesion: 0.40
Nodes (5): production, budgets, buildTarget, fileReplacements, outputHashing

### Community 107 - "InspectionReportBannersComponent"
Cohesion: 0.40
Nodes (4): InspectionBanner, InspectionReportBannersComponent, Component, Input

### Community 108 - "status-badge.component.ts"
Cohesion: 0.40
Nodes (3): BadgeSeverity, StatusBadgeComponent, Component

### Community 109 - "sync-portal-version.mjs"
Cohesion: 0.40
Nodes (3): outputPath, packageJsonPath, root

### Community 110 - "test-integration"
Cohesion: 0.50
Nodes (4): test-integration, executor, outputs, {workspaceRoot}/coverage/api-integration

### Community 111 - "OTS Brand Mark"
Cohesion: 0.67
Nodes (4): OTS Apple Touch Icon, OTS Brand Mark, OTS Favicon, OTS PWA Icon 192x192

### Community 116 - "ShellComponent"
Cohesion: 0.67
Nodes (3): F0.1.1 Portal Shell + Navigation, ShellComponent, Single Shell Rule

### Community 117 - "schema.prisma"
Cohesion: 0.67
Nodes (3): T0.2 Changes, schema.prisma, T0.2 Diff Summary

### Community 118 - "OTS App Icon (512x512)"
Cohesion: 1.00
Nodes (3): OTS App Icon (512x512), OTS Maskable Icon (192x192), OTS Maskable Icon (512x512)

### Community 119 - "Authentication Feature Area"
Cohesion: 0.67
Nodes (3): First-Login Change Password Template, Authentication Feature Area, Login Split-Panel Template

### Community 120 - "Report Status Workflow / Transitions"
Cohesion: 0.67
Nodes (3): Report Status Workflow / Transitions, Workflow Transition Bar Section Template, Transition History Timeline Section Template

## Knowledge Gaps
- **445 isolated node(s):** `singleQuote`, `semi`, `trailingComma`, `printWidth`, `tabWidth` (+440 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **97 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `@angular-devkit/build-angular`, `@angular/forms`, `@angular/platform-browser-dynamic`, `@angular/router`, `bcrypt`, `class-transformer`, `class-validator`, `exceljs`, `form-data`, `export.service.ts`, `@nestjs/config`, `@nestjs/passport`, `passport`, `passport-jwt`, `reflect-metadata`, `rxjs`, `@types/jszip`, `package.json`, `@angular/compiler`, `@angular/core`?**
  _High betweenness centrality (0.067) - this node is a cross-community bridge._
- **Why does `jszip` connect `export.service.ts` to `dependencies`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **Why does `AuthenticatedRequest` connect `AuthenticatedRequest` to `FilesService`, `InspectionReportWorkflowService`, `AuthService`, `template-upload.integration.spec.ts`, `SerialNumbersController`, `export.service.ts`, `UsersService`, `customers.controller.ts`, `CustomersService`, `RevisionService`, `inspection-reports.controller.ts`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `InspectionReportDetailComponent` (e.g. with `ChildReportDetailComponent` and `InspectionReportListComponent`) actually correct?**
  _`InspectionReportDetailComponent` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `singleQuote`, `semi`, `trailingComma` to the rest of the system?**
  _445 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `FilesService` be split into smaller, more focused modules?**
  _Cohesion score 0.06334841628959276 - nodes in this community are weakly interconnected._
- **Should `AppRole` be split into smaller, more focused modules?**
  _Cohesion score 0.06787330316742081 - nodes in this community are weakly interconnected._