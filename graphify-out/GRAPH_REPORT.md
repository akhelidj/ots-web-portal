# Graph Report - ots-web-portal  (2026-08-04)

## Corpus Check
- 260 files · ~112,209 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1998 nodes · 3361 edges · 232 communities (130 shown, 102 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 37 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `24b11c0a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

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
- FakeOutboxLocalRepo
- .transition
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
- AppService
- ChildReportsService
- LocalInspectionApprovalBatch
- development
- api/tsconfig.json
- .downloadAttachment
- .onShellScroll()
- targets
- Admin Inspection Templates Template
- SettingsComponent
- options
- ApproveBatchDto
- portal/project.json
- options
- test
- http-error.utils.ts
- SyncOrchestratorService
- InspectionReportApprovalBatchesComponent
- DefaultDenyGuard
- Customer role workspace (view reports,
- .prettierrc.json
- serve
- seed.ts
- .exportInspectionReport
- InspectionReportHeaderComponent
- build
- OutboxService
- ChangePasswordComponent
- InspectionReportAddSerialPanelComponent
- InspectionReportHeaderComponent
- global-setup.ts
- OTS Monorepo
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
- revision-snapshot.integration.spec.ts
- jwt.strategy.spec.ts
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
- create-template-binding.integration.spec.ts
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
- .saveEditSn()
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
- App Root Shell Template
- Register Inventory (Add Serials) Panel
- Report Banners Section Template
- Report Header (Condensing) Section Template
- KPI Overview (Disposition Stats) Section
- conflict-terminal.spec.ts
- Known Issues
- ADR-0008 — No shared DTO package
- adr/README.md
- ADR-0001 — Revision-snapshot engine
- ADR-0002 — Optimistic concurrency everywhere
- ADR-0003 — Multi-tenant model (tenantId scoping, single DB gateway)
- ADR-0004 — JWT default-deny RBAC
- ADR-0005 — Export determinism is structural-only
- ADR-0006 — Offline-sync core
- ADR-0009 — Single-template hardcode with an unwired multi-template seam
- Build / test tooling
- Type system / upstream friction
- @angular/common
- fake-indexeddb

## God Nodes (most connected - your core abstractions)
1. `InspectionReportDetailComponent` - 78 edges
2. `AuthenticatedRequest` - 54 edges
3. `PrismaService` - 50 edges
4. `ChildReportDetailComponent` - 38 edges
5. `InspectionReportsService` - 38 edges
6. `LocalSerialNumber` - 36 edges
7. `AppRole` - 35 edges
8. `Roles()` - 31 edges
9. `SessionService` - 28 edges
10. `LocalInspectionReport` - 27 edges

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
- **Auth feature templates (login, change-password, settings)** — portal_src_app_features_auth_components_login_login_component_template, portal_src_app_features_auth_components_change_password_change_password_component_template [EXTRACTED 1.00]
- **Role-specific workspaces sharing inspection report list** — portal_src_app_features_workspaces_customer_customer_workspace_component_concept, portal_src_app_features_workspaces_receiver_receiver_workspace_component_concept, portal_src_app_features_workspaces_supervisor_supervisor_workspace_component_concept [INFERRED 0.85]
- **Template versioning, binding and export lifecycle** — docs_architecture_template_versioning_template_entity, docs_architecture_inspection_report_template_binding_binding, docs_architecture_export_mapping_drill_pipe_v1_mapping, docs_architecture_revision_snapshot_engine_engine [INFERRED 0.85]
- **Symmetric frontend/backend PENDING_APPROVAL gating** — docs_architecture_inspection_form_schema_reportvalidationservice, docs_architecture_inspection_form_schema_workflowservice, claudemd_pending_approval_gate, docs_api_dispositions_validation_failed [INFERRED 0.85]
- **Offline-first outbox sync and temporal-ID remap flow** — claudemd_offline_sync_core, claudemd_syncdispatcher, claudemd_temporal_id_remap, docs_api_serial_numbers_endpoints_clientref, docs_api_serial_number_inspection_outbox [INFERRED 0.85]
- **Page Layout Composition Slot Family** — portal_src_app_shared_components_layout_page_layout_page_layout_component_pagelayoutcomponent, portal_src_app_shared_components_layout_page_identity_page_identity_component_pageidentitycomponent, portal_src_app_shared_components_layout_page_actions_page_actions_component_pageactionscomponent, portal_src_app_shared_components_layout_page_summary_page_summary_component_pagesummarycomponent, portal_src_app_shared_components_layout_page_workspace_page_workspace_component_pageworkspacecomponent, portal_src_app_shared_components_layout_page_secondary_panel_page_secondary_panel_component_pagesecondarypanelcomponent [INFERRED 0.75]
- **Inspection Report Detail Section Components** — portal_src_app_features_inspections_components_inspection_report_detail_inspection_report_detail_component_inspectionreportdetailcomponent, portal_src_app_features_inspections_components_inspection_report_detail_sections_inspection_report_header_component_inspectionreportheadercomponent, portal_src_app_features_inspections_components_inspection_report_detail_sections_inspection_report_serials_table_inspection_report_serials_table_component_inspectionreportserialstablecomponent, portal_src_app_features_inspections_components_inspection_report_detail_sections_inspection_report_transition_actions_component_inspectionreporttransitionactionscomponent [INFERRED 0.75]

## Communities (232 total, 102 thin omitted)

### Community 0 - "FilesService"
Cohesion: 0.20
Nodes (11): ChildReportsController, Body, Controller, Get, Param, Patch, Post, Query (+3 more)

### Community 1 - "AppRole"
Cohesion: 0.06
Nodes (45): AppRole, ChildReportStatus, ActionState, Banner, ChildReportUiPolicyContext, ChildReportUiState, getChildReportUiState(), TransitionOption (+37 more)

### Community 2 - "RevisionService (single source of truth)"
Cohesion: 0.05
Nodes (51): Offline-Sync Core Subsystem, Optimistic Concurrency Pattern, OTS Web Portal Monorepo Reference, PENDING_APPROVAL Transition Gate, PrismaService (single DB gateway), RevisionService / Revision-Snapshot Engine, SyncDispatcher, SyncOrchestrator (+43 more)

### Community 3 - "app.routes.ts"
Cohesion: 0.09
Nodes (20): appRoutes, authGuard(), mustChangePasswordGuard(), roleGuard(), RoleLandingService, Injectable, AppRoutes, NavigationService (+12 more)

### Community 4 - "types.ts"
Cohesion: 0.12
Nodes (12): ChildReportType, LocalBatchSerialNumber, LocalInspectionApprovalBatch, MetaRecord, OutboxStatus, SerialApprovalStatus, ApprovalBatchLocalRepo, Injectable (+4 more)

### Community 5 - "AuthService"
Cohesion: 0.08
Nodes (21): AuthController, Body, Controller, Get, Post, Req, UseGuards, AuthService (+13 more)

### Community 6 - "inspection-report-detail.component.ts"
Cohesion: 0.11
Nodes (27): RFC-5987, APP_ROLES, BATCH_STATUSES, BatchStatus, CHILD_REPORT_TYPES, EntityType, REPORT_STATUSES, ReportStatus (+19 more)

### Community 7 - "template-upload.integration.spec.ts"
Cohesion: 0.20
Nodes (7): TemplateFileStoreService, Injectable, TemplateService, Injectable, TemplateValidationService, Injectable, XLSX_MIME_TYPES

### Community 8 - "InspectionReportDetailComponent"
Cohesion: 0.06
Nodes (11): InspectionReportDetailComponent, Component, ViewChild, InspectionReportAddSerialPanelComponent, InspectionReportApprovalBatchesComponent, InspectionReportBannersComponent, InspectionReportHeaderComponent, InspectionReportKpiOverviewComponent (+3 more)

### Community 9 - "nx.json"
Cohesion: 0.05
Nodes (37): cache, dependsOn, inputs, defaultBase, generators, @nx/angular:application, @nx/angular:library, @nx/nest:application (+29 more)

### Community 10 - "ConnectivityService"
Cohesion: 0.17
Nodes (6): UserProfile, ConnectivityService, Injectable, AppSyncState, AuthRequiredComponent, Component

### Community 11 - "SystemNoticeService"
Cohesion: 0.08
Nodes (15): App, appConfig, Component, NoticeType, SystemNotice, SystemNoticeService, Injectable, SystemNoticeComponent (+7 more)

### Community 12 - "app.module.ts"
Cohesion: 0.15
Nodes (17): AppModule, Module, AuthModule, Module, InspectionReportsModule, Module, PrismaModule, Module (+9 more)

### Community 13 - "ChildReportDetailComponent"
Cohesion: 0.10
Nodes (3): ChildReportDetailComponent, Component, SerialInspectionReactiveFormComponent

### Community 14 - "PrismaService"
Cohesion: 0.10
Nodes (7): CreateInspectionReportDto, IsNotEmpty, IsString, InspectionReportsService, Injectable, PrismaService, Injectable

### Community 15 - "LocalUser"
Cohesion: 0.10
Nodes (8): LocalUser, Injectable, UserLocalRepo, AdminUsersComponent, Component, ViewChild, AdminUsersService, Injectable

### Community 17 - "export.service.ts"
Cohesion: 0.15
Nodes (16): Snapshot, ExportController, Controller, ExportModule, Module, ExportService, Injectable, cloneRowForNumber() (+8 more)

### Community 19 - "inspection-report-list.component.ts"
Cohesion: 0.12
Nodes (15): ReportValidationService, Injectable, ValidationIssue, ValidationResult, InspectionReportTransitionActionComponent, SelectedTransition, TransitionChoice, Component (+7 more)

### Community 20 - "compilerOptions"
Cohesion: 0.07
Nodes (27): dom, es2020, node_modules, portal/src/app/*, portal/src/environments/*, tmp, compileOnSave, compilerOptions (+19 more)

### Community 21 - "UsersService"
Cohesion: 0.11
Nodes (14): Body, Controller, Delete, Get, Param, Patch, Post, Req (+6 more)

### Community 22 - "customers.controller.ts"
Cohesion: 0.12
Nodes (17): CustomersModule, Module, CustomerAuditAction, CreateCustomerDto, IsBoolean, IsEmail, IsOptional, IsString (+9 more)

### Community 23 - "CustomersService"
Cohesion: 0.14
Nodes (12): CustomersController, Body, Controller, Delete, Get, Param, Patch, Post (+4 more)

### Community 24 - "RevisionService"
Cohesion: 0.14
Nodes (11): RevisionService, Injectable, TransitionRequestDto, ChildReportWorkflowService, Injectable, DRILL_PIPE_REQUIRED_KEYS, allowedTransitionMap, CHILD_REPORT_TRANSITIONS (+3 more)

### Community 25 - "scripts"
Cohesion: 0.08
Nodes (24): scripts, build:api, build:deploy, build:portal, db:generate, db:migrate, db:reset, db:seed (+16 more)

### Community 26 - "prisma.service.ts"
Cohesion: 0.53
Nodes (4): ChildSnapshot, SnapshotEquipment, SnapshotInspectionMethod, SnapshotTransitionLog

### Community 27 - "SerialInspectionReactiveFormComponent"
Cohesion: 0.21
Nodes (4): SerialInspectionReactiveFormComponent, Component, Input, Output

### Community 28 - "inspection-reports.controller.ts"
Cohesion: 0.26
Nodes (5): RolesGuard, Injectable, CreateUserDto, UpdateUserActiveDto, UpdateUserDto

### Community 29 - "AuthenticatedRequest"
Cohesion: 0.29
Nodes (12): AuthenticatedRequest, Roles(), InspectionReportsController, Body, Controller, Get, Param, Patch (+4 more)

### Community 30 - "compilerOptions"
Cohesion: 0.09
Nodes (21): angularCompilerOptions, enableI18nLegacyMessageIdFormat, strictInjectionParameters, strictInputAccessModifiers, strictTemplates, compilerOptions, emitDecoratorMetadata, isolatedModules (+13 more)

### Community 31 - "dependencies"
Cohesion: 0.10
Nodes (21): @angular/animations, @angular-devkit/build-angular, @angular/platform-browser, @angular/service-worker, axios, @nestjs/common, @nestjs/core, @nestjs/jwt (+13 more)

### Community 32 - "OutboxItem"
Cohesion: 0.16
Nodes (5): OutboxItem, OutboxLocalRepo, Injectable, SyncDispatcherService, Injectable

### Community 33 - "InspectionReportWorkflowService"
Cohesion: 0.15
Nodes (10): InspectionReportWorkflowController, TransitionRequestDto, Body, Controller, Get, Param, Post, Req (+2 more)

### Community 34 - "LocalCustomer"
Cohesion: 0.11
Nodes (9): TEMPLATE_KEYS, LocalCustomer, CustomerLocalRepo, Injectable, Injectable, UserPreferences, UserPreferencesService, AdminCustomersService (+1 more)

### Community 35 - "child-report-detail.component.ts"
Cohesion: 0.18
Nodes (6): UploadedFileDto, ChildReportsModule, Module, AuthUser, FilesService, Injectable

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
Cohesion: 0.23
Nodes (5): LocalSerialNumber, InspectionReportSerialsTableComponent, Component, Input, Output

### Community 41 - "SerialNumbersController"
Cohesion: 0.13
Nodes (13): InspectionData, SerialNumbersController, Body, Controller, Delete, Get, Param, Patch (+5 more)

### Community 42 - "compilerOptions"
Cohesion: 0.13
Nodes (14): compilerOptions, module, moduleResolution, outDir, types, extends, include, jest (+6 more)

### Community 43 - "Offline-Sync Confirmed Risks Index"
Cohesion: 0.13
Nodes (11): TemplateController, Body, Controller, Get, Param, Patch, Post, Req (+3 more)

### Community 45 - "LocalTransitionLog"
Cohesion: 0.19
Nodes (6): LocalTransitionLog, TransitionLogLocalRepo, Injectable, InspectionReportTransitionHistoryComponent, Component, Input

### Community 46 - "devDependencies"
Cohesion: 0.15
Nodes (13): dotenv-cli, @eslint/js, jest-preset-angular, @nx/eslint, @nx/webpack, @nx/workspace, devDependencies, dotenv-cli (+5 more)

### Community 47 - "targets"
Cohesion: 0.17
Nodes (11): name, projectType, dependsOn, executor, $schema, sourceRoot, tags, targets (+3 more)

### Community 48 - "Inspection Report Lifecycle Trace"
Cohesion: 0.40
Nodes (3): LoginComponent, Component, ViewChild

### Community 49 - "Revision Snapshot on Approval/Reopen"
Cohesion: 0.40
Nodes (4): InspectionBanner, InspectionReportBannersComponent, Component, Input

### Community 50 - "AdminCustomersService"
Cohesion: 0.22
Nodes (9): CHILD_REPORT_STATUSES, ENTITY_TYPES, HydrationOptions, DATA_HYDRATION_SOURCES, DataHydrationContext, DataHydrationSource, provideDataHydrationSource(), AdminTemplateItem (+1 more)

### Community 51 - "ChildReportsService"
Cohesion: 0.13
Nodes (5): LocalChildReport, ChildReportLocalRepo, Injectable, ChildReportsService, Injectable

### Community 52 - "ShellComponent"
Cohesion: 0.18
Nodes (3): NavigationService, ShellComponent, Component

### Community 54 - ".transition"
Cohesion: 0.22
Nodes (7): ChildReportWorkflowController, Body, Controller, Get, Param, Post, Req

### Community 56 - "AdminTemplatesComponent"
Cohesion: 0.18
Nodes (4): AdminTemplatesComponent, Component, AdminTemplatesService, Injectable

### Community 57 - "InspectionReportReworkStatusComponent"
Cohesion: 0.22
Nodes (4): InspectionReportReworkStatusComponent, Component, Input, Output

### Community 58 - "portal/tsconfig.app.json"
Cohesion: 0.18
Nodes (10): compilerOptions, outDir, types, exclude, extends, include, src/**/*.spec.ts, src/**/*.test.ts (+2 more)

### Community 59 - "api/src/main.ts"
Cohesion: 0.29
Nodes (3): AllExceptionsFilter, NOTE: intentionally reads `.message`, NOT `.getResponse()` — the resulting, Catch

### Community 60 - "jwt.strategy.ts"
Cohesion: 0.33
Nodes (4): AuthenticatedUser, JwtPayload, JwtStrategy, Injectable

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
Cohesion: 0.50
Nodes (5): ConnectivityService, DbService (IndexedDB), OutboxService, PWA Offline Network State of Play, SyncOrchestratorService

### Community 69 - "AppService"
Cohesion: 0.27
Nodes (5): AppController, Controller, Get, AppService, Injectable

### Community 71 - "LocalInspectionApprovalBatch"
Cohesion: 0.50
Nodes (7): allCellTexts(), approveWithSerials(), loadSheet(), newSeededDraft(), readCellText(), rowTextsFor(), serialRowOrder()

### Community 72 - "development"
Cohesion: 0.25
Nodes (8): configurations, development, production, args, buildTarget, buildTarget, configurations, --node-env=development

### Community 73 - "api/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, esModuleInterop, extends, files, include, ../tsconfig.base.json, references

### Community 74 - ".downloadAttachment"
Cohesion: 0.25
Nodes (6): FilesController, Controller, Get, Param, Request, Res

### Community 76 - "targets"
Cohesion: 0.25
Nodes (8): executor, configurations, continuous, defaultConfiguration, executor, targets, lint, serve

### Community 77 - "Admin Inspection Templates Template"
Cohesion: 0.25
Nodes (8): Offline / Connectivity State UI, Customer Entity, Offline Sync State (PENDING/CONFLICT/ERROR/SYNCED), Admin Customer Directory Template, Create Inspection Report Template, Serial Inspection Reactive Form Template, Inspection Template / Schema Entity, Admin Inspection Templates Template

### Community 79 - "options"
Cohesion: 0.29
Nodes (7): executor, options, args, command, cwd, build, --node-env=production

### Community 80 - "ApproveBatchDto"
Cohesion: 0.25
Nodes (6): ApproveBatchDto, IsArray, IsInt, IsOptional, IsString, Min

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
Cohesion: 0.36
Nodes (7): apiErrorInterceptor(), ErrorPayload, ErrorPayloadObject, extractBackendErrorMessage(), extractRecordMessages(), joinMessages(), withNormalizedHttpErrorMessage()

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

### Community 92 - ".exportInspectionReport"
Cohesion: 0.33
Nodes (5): Get, Param, Query, Req, Res

### Community 93 - "InspectionReportHeaderComponent"
Cohesion: 0.33
Nodes (4): InspectionReportHeaderComponent, Component, Input, Output

### Community 94 - "build"
Cohesion: 0.33
Nodes (6): configurations, defaultConfiguration, executor, outputs, build, {options.outputPath}

### Community 97 - "InspectionReportAddSerialPanelComponent"
Cohesion: 0.33
Nodes (4): InspectionReportAddSerialPanelComponent, Component, Input, Output

### Community 98 - "InspectionReportHeaderComponent"
Cohesion: 0.15
Nodes (6): LocalInspectionReport, InspectionReportLocalRepo, Injectable, InspectionReportListComponent, Component, Input

### Community 100 - "OTS Monorepo"
Cohesion: 0.50
Nodes (5): Postgres Service (Docker), Angular Portal, NestJS API, OTS Monorepo, Prisma ORM

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
Cohesion: 0.12
Nodes (15): Conflict resolution when the same report is edited offline _and_ online, Docs vs. reality — flagged for spec cross-check, Hop 10 — Approval-batch pipeline, Hop 1 — Create on device (offline), Hop 2 — IndexedDB via local repo, Hop 3 — Outbox enqueue, Hop 4 — Sync trigger, Hop 5 — Outbox drain (ordering + dependency gating) (+7 more)

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

### Community 118 - "OTS App Icon (512x512)"
Cohesion: 1.00
Nodes (3): OTS App Icon (512x512), OTS Maskable Icon (192x192), OTS Maskable Icon (512x512)

### Community 119 - "Authentication Feature Area"
Cohesion: 0.67
Nodes (3): First-Login Change Password Template, Authentication Feature Area, Login Split-Panel Template

### Community 120 - "Report Status Workflow / Transitions"
Cohesion: 0.67
Nodes (3): Report Status Workflow / Transitions, Workflow Transition Bar Section Template, Transition History Timeline Section Template

### Community 128 - "@angular-devkit/build-angular"
Cohesion: 0.21
Nodes (3): jwtInterceptor(), SessionService, Injectable

### Community 215 - "Known Issues"
Cohesion: 0.20
Nodes (9): 1. A conflicted entity row never returns to SYNCED, 2. `clearConflicts` over-deletes and discards the local edit, 3. `idempotencyKey` is generated but never transmitted, 4. PENDING_APPROVAL gate reads a disposition field production never writes, 5. Global exception filter flattens structured HttpException bodies, 6. Environment variables are not validated at boot, API-side data / validation, Known Issues (+1 more)

### Community 216 - "ADR-0008 — No shared DTO package"
Cohesion: 0.25
Nodes (6): ADR-0008 — No shared DTO package, Consequences, Context, Decision, API Documentation, Endpoints

### Community 217 - "adr/README.md"
Cohesion: 0.29
Nodes (5): ADR-0007 — REWORK asymmetry, Consequences, Context, Decision, Architecture Decision Records

### Community 219 - "ADR-0001 — Revision-snapshot engine"
Cohesion: 0.40
Nodes (4): ADR-0001 — Revision-snapshot engine, Consequences, Context, Decision

### Community 220 - "ADR-0002 — Optimistic concurrency everywhere"
Cohesion: 0.40
Nodes (4): ADR-0002 — Optimistic concurrency everywhere, Consequences, Context, Decision

### Community 221 - "ADR-0003 — Multi-tenant model (tenantId scoping, single DB gateway)"
Cohesion: 0.40
Nodes (4): ADR-0003 — Multi-tenant model (tenantId scoping, single DB gateway), Consequences, Context, Decision

### Community 222 - "ADR-0004 — JWT default-deny RBAC"
Cohesion: 0.40
Nodes (4): ADR-0004 — JWT default-deny RBAC, Consequences, Context, Decision

### Community 223 - "ADR-0005 — Export determinism is structural-only"
Cohesion: 0.40
Nodes (4): ADR-0005 — Export determinism is structural-only, Consequences, Context, Decision

### Community 224 - "ADR-0006 — Offline-sync core"
Cohesion: 0.40
Nodes (4): ADR-0006 — Offline-sync core, Consequences, Context, Decision

### Community 225 - "ADR-0009 — Single-template hardcode with an unwired multi-template seam"
Cohesion: 0.40
Nodes (4): ADR-0009 — Single-template hardcode with an unwired multi-template seam, Consequences, Context, Decision

### Community 226 - "Build / test tooling"
Cohesion: 0.50
Nodes (4): 10. Portal spec tsconfig cannot type-check (phantom errors), 11. Two latent type errors invisible to Jest (swc transpile, not tsc), 12. JWT secret and revision number reach strict-null-check sites as possibly-undefined, Build / test tooling

### Community 227 - "Type system / upstream friction"
Cohesion: 0.50
Nodes (4): 7. ExcelJS / JSZip buffer loads require `as unknown as` casts, 8. `@types/multer` is not installed, 9. Prisma `JsonValue` is not directly indexable, Type system / upstream friction

## Knowledge Gaps
- **466 isolated node(s):** `stubConfig`, `basePayload`, `ADR-0009`, `REAL_TEMPLATE_BYTES`, `1. A conflicted entity row never returns to SYNCED` (+461 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **102 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `@angular/forms`, `@angular/platform-browser-dynamic`, `@angular/router`, `bcrypt`, `class-transformer`, `class-validator`, `exceljs`, `form-data`, `export.service.ts`, `@nestjs/config`, `@nestjs/passport`, `passport`, `passport-jwt`, `reflect-metadata`, `rxjs`, `@types/jszip`, `@angular/common`, `package.json`, `@angular/compiler`, `@angular/core`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **Why does `jszip` connect `export.service.ts` to `dependencies`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Why does `AuthenticatedRequest` connect `AuthenticatedRequest` to `FilesService`, `InspectionReportWorkflowService`, `child-report-detail.component.ts`, `AuthService`, `SerialNumbersController`, `.downloadAttachment`, `Offline-Sync Confirmed Risks Index`, `.exportInspectionReport`, `export.service.ts`, `UsersService`, `customers.controller.ts`, `CustomersService`, `RevisionService`, `.transition`, `inspection-reports.controller.ts`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `InspectionReportDetailComponent` (e.g. with `ChildReportDetailComponent` and `InspectionReportListComponent`) actually correct?**
  _`InspectionReportDetailComponent` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `stubConfig`, `basePayload`, `ADR-0009` to the rest of the system?**
  _466 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `AppRole` be split into smaller, more focused modules?**
  _Cohesion score 0.055191256830601096 - nodes in this community are weakly interconnected._
- **Should `RevisionService (single source of truth)` be split into smaller, more focused modules?**
  _Cohesion score 0.05333333333333334 - nodes in this community are weakly interconnected._