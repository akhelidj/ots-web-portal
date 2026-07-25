# Graph Report - .  (2026-07-25)

## Corpus Check
- 291 files · ~97,447 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1813 nodes · 3114 edges · 183 communities (101 shown, 82 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 47 edges (avg confidence: 0.81)
- Token cost: 284,000 input · 16,000 output

## Community Hubs (Navigation)
- Child Reports API (Nest)
- API Reference Docs
- Portal Build Config (Nx)
- Customers API (Nest)
- Help Content & Roles
- App Shell & System Notices
- Auth API (Nest)
- Portal Routing & Auth Guards
- Child Report Detail (UI+Policy)
- Inspection Report Detail (UI)
- Nx Workspace Config
- Auth Session & Constants
- portal_src_app_features
- api_src_app_export
- portal_src_app_features
- api_src_app_serial
- api_src_app_users
- portal_src_app_core
- ref_dom
- api_src_app_inspection
- portal_src_app_features
- api_src_app_auth
- portal_src_app_features
- portal_src_app_features
- portal_src_app_shared
- portal_tsconfig
- api_src_app_inspection
- api_src_app_workflow
- api_src_app_inspection
- api_src_app_template
- portal_src_app_features
- docs_tickets_t0_1
- portal_src_app_shared
- portal_src_app_features
- angular_animations
- api_src_app_template
- api_src_app_workflow
- api_src_app_workflow
- package_scripts_db_seed
- portal_src_app_features
- portal_src_app_features
- portal_src_app_features
- api_tsconfig_app_compileroptions
- portal_src_app_core
- portal_src_app_core
- portal_src_app_core
- portal_src_app_features
- portal_src_app_core
- portal_src_app_features
- angular_build
- portal_src_app_features
- portal_src_app_features
- portal_src_app_shared
- portal_tsconfig_app_compileropti
- api_src_app_app
- docs_tickets_f0_1
- docs_tickets_f0_2
- portal_src_app_core
- portal_src_app_core
- docs_tickets_f0_1
- docs_tickets_f0_2
- portal_src_app_core
- portal_src_app_core
- portal_src_app_core
- portal_src_app_core
- api_project_build_configurations
- api_project_copy_workspace
- api_src_app_inspection
- api_src_app_inspection
- api_tsconfig
- docs_tickets_f0_1
- portal_src_app_features
- portal_src_app_core
- portal_src_app_core
- portal_src_app_features
- portal_src_app_features
- api_project_build_executor
- api_src_app_app
- docs_tickets_f0_1
- docs_tickets_f0_2
- docs_tickets_t0_2
- portal_src_app_features
- portal_src_app_core
- portal_src_app_core
- portal_src_app_features
- portal_src_app_features
- portal_src_app_shared
- api_project
- api_project_prune_dependson
- api_project_prune_lockfile
- api_scripts_seed
- api_src_app_common
- portal_src_app_features
- portal_src_app_features
- portal_src_app_features
- api_project_copy_workspace
- api_project_copy_workspace
- docs_tickets_f0_1
- docs_tickets_f0_3
- package
- portal_ngsw_config
- portal_src_app_features
- portal_src_app_features
- portal_src_app_shared
- scripts_sync_portal_version
- portal_src_app_core
- portal_src_app_features
- portal_test_nested
- api_check_duplicates
- api_webpack_config
- portal_src_app_nx
- portal_tailwind_config
- angular_cli
- angular_common
- angular_compiler_cli
- angular_devkit_build_angular
- angular_devkit_schematics
- angular_eslint
- angular_forms
- angular_language_service
- angular_platform_browser
- angular_platform_browser_dynamic
- angular_service_worker
- autoprefixer
- axios
- bcrypt
- class_transformer
- class_validator
- docs_tickets_f0_1
- docs_tickets_f0_2
- dotenv
- dotenv_cli
- eslint
- eslint_config_prettier
- eslint_js
- exceljs
- form_data
- nestjs_common
- nestjs_core
- nestjs_jwt
- nestjs_passport
- nestjs_testing
- nx_angular
- nx_eslint_plugin
- nx_js
- nx_nest
- nx_node
- nx_web
- nx_webpack
- package_dependencies_passport
- package_dependencies_passport_jw
- package_dependencies_prisma_clie
- package_dependencies_reflect_met
- package_devdependencies_nx
- package_devdependencies_postcss
- package_devdependencies_prettier
- package_devdependencies_prisma
- package_devdependencies_schemati
- package_devdependencies_swc_core
- package_devdependencies_swc_help
- package_devdependencies_swc_node
- package_devdependencies_tailwind
- package_devdependencies_tslib
- package_devdependencies_types_bc
- package_devdependencies_types_no
- package_devdependencies_types_pa
- package_devdependencies_typescri
- package_devdependencies_typescri
- package_devdependencies_typescri
- package_devdependencies_webpack_
- portal_src_app_app
- portal_src_app_features
- portal_src_environments_environm
- docs_tickets_shared_offline
- docs_tickets_t0_2

## God Nodes (most connected - your core abstractions)
1. `InspectionReportDetailComponent` - 66 edges
2. `PrismaService` - 48 edges
3. `InspectionReportsService` - 38 edges
4. `LocalSerialNumber` - 36 edges
5. `ChildReportDetailComponent` - 36 edges
6. `AppRole` - 35 edges
7. `Roles()` - 31 edges
8. `SessionService` - 28 edges
9. `LocalInspectionReport` - 27 edges
10. `ConnectivityService` - 27 edges

## Surprising Connections (you probably didn't know these)
- `ShellComponent` --references--> `Angular Portal`  [INFERRED]
  docs/tickets/F0.1.1.md → README.md
- `NestJS API` --shares_data_with--> `Postgres Service (Docker)`  [INFERRED]
  README.md → docker-compose.yml
- `Prisma ORM` --shares_data_with--> `Postgres Service (Docker)`  [INFERRED]
  README.md → docker-compose.yml
- `Idempotent POST via Client-Supplied UUID` --semantically_similar_to--> `Atomic Temporal ID Remapping`  [INFERRED] [semantically similar]
  docs/tickets/F0.3.1.md → docs/tickets/F0.1.4.md
- `Optimistic Concurrency Control (version field)` --semantically_similar_to--> `409 Conflict Halt Strategy`  [INFERRED] [semantically similar]
  docs/tickets/F0.1.5.md → docs/tickets/F0.1.4.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Offline-First Sync Stack** — docs_architecture_pwa_offline_network_state_of_play_db_service, docs_architecture_pwa_offline_network_state_of_play_outbox_service, docs_architecture_pwa_offline_network_state_of_play_sync_orchestrator, docs_tickets_f0_1_2_outbox_pattern [EXTRACTED 0.85]
- **Template Immutability & Binding Chain** — docs_architecture_template_versioning_template_versioning, docs_architecture_inspection_report_template_binding_template_binding, docs_api_inspection_reports_endpoints_inspection_report [INFERRED 0.85]
- **PENDING_APPROVAL Validation Gating** — docs_architecture_inspection_form_schema_report_validation_service, docs_architecture_inspection_form_schema_workflow_service, docs_api_dispositions_disposition_enum, docs_api_serial_numbers_endpoints_serial_number [INFERRED 0.85]
- **Offline-First Sync Pipeline (Outbox + Local Repo + Atomic Remapping)** — docs_tickets_f0_1_4_write_through_outbox, docs_tickets_f0_1_5_sync_dispatcher_service, docs_tickets_f0_1_7_sync_orchestrator_service, docs_tickets_f0_1_4_atomic_temporal_id_remapping, docs_tickets_shared_offline_first [INFERRED 0.85]
- **T0.2 Prisma/Postgres Data Layer Baseline** — docs_tickets_t0_2_01_plan_prisma_postgres, docs_tickets_t0_2_01_plan_prisma_service, docs_tickets_t0_2_01_plan_wsl_docker_named_volume, docs_tickets_t0_2_03_changes_schema_prisma [EXTRACTED 0.75]
- **Inspection Report Workflow Entity Chain** — docs_tickets_f0_2_1_inspection_report, docs_tickets_f0_2_2_serial_number, docs_tickets_f0_3_1_child_report, docs_tickets_t0_4_state_transition_matrix [INFERRED 0.85]
- **Inspection Report Detail composed of section components** — portal_src_app_features_inspections_components_inspection_report_detail_inspection_report_detail_component_template, portal_src_app_features_inspections_components_inspection_report_detail_sections_inspection_report_header_inspection_report_header_component_template, portal_src_app_features_inspections_components_inspection_report_detail_sections_inspection_report_banners_inspection_report_banners_component_template, portal_src_app_features_inspections_components_inspection_report_detail_sections_inspection_report_kpi_overview_inspection_report_kpi_overview_component_template, portal_src_app_features_inspections_components_inspection_report_detail_sections_inspection_report_rework_status_inspection_report_rework_status_component_template, portal_src_app_features_inspections_components_inspection_report_detail_sections_inspection_report_serials_table_inspection_report_serials_table_component_template, portal_src_app_features_inspections_components_inspection_report_detail_sections_inspection_report_add_serial_panel_inspection_report_add_serial_panel_component_template, portal_src_app_features_inspections_components_inspection_report_detail_sections_inspection_report_approval_batches_inspection_report_approval_batches_component_template, portal_src_app_features_inspections_components_inspection_report_detail_sections_inspection_report_transition_history_inspection_report_transition_history_component_template [EXTRACTED 1.00]
- **Serial approval workflow spans table, batches and transition sections** — portal_src_app_features_inspections_components_inspection_report_detail_sections_inspection_report_serials_table_inspection_report_serials_table_component_template, portal_src_app_features_inspections_components_inspection_report_detail_sections_inspection_report_approval_batches_inspection_report_approval_batches_component_template, portal_src_app_features_inspections_components_inspection_report_detail_sections_inspection_report_transition_bar_inspection_report_transition_bar_component_template [INFERRED 0.75]
- **Auth feature templates (login, change-password, settings)** — portal_src_app_features_auth_components_login_login_component_template, portal_src_app_features_auth_components_change_password_change_password_component_template, portal_src_app_features_auth_components_settings_settings_component_template [EXTRACTED 1.00]
- **Role-specific workspaces sharing inspection report list** — portal_src_app_features_workspaces_customer_customer_workspace_component_concept, portal_src_app_features_workspaces_receiver_receiver_workspace_component_concept, portal_src_app_features_workspaces_supervisor_supervisor_workspace_component_concept [INFERRED 0.85]
- **Page layout composition primitives** — portal_src_app_shared_components_layout_page_layout_page_layout_component_template, portal_src_app_shared_components_layout_page_identity_page_identity_component_template, portal_src_app_shared_components_layout_page_workspace_page_workspace_component_template [INFERRED 0.85]
- **Global feedback surfaces (toast, system notice, sync status)** — portal_src_app_shared_toast_toast_component_concept, portal_src_app_shared_system_notice_system_notice_component_concept, portal_src_app_shared_shell_shell_component_sync_status_indicator [INFERRED 0.75]

## Communities (183 total, 82 thin omitted)

### Community 0 - "Child Reports API (Nest)"
Cohesion: 0.06
Nodes (25): ChildReportsController, Body, Controller, Get, Param, Patch, Post, Query (+17 more)

### Community 1 - "API Reference Docs"
Cohesion: 0.06
Nodes (49): Child Report, Child Reports API, Deterministic Idempotency, Optimistic Concurrency Control, Customer Entity, Customers API, Tenant Isolation, Disposition Enum (PASS/REWORK/SCRAP/HOLD) (+41 more)

### Community 2 - "Portal Build Config (Nx)"
Cohesion: 0.04
Nodes (47): configurations, defaultConfiguration, executor, options, outputs, development, production, buildTarget (+39 more)

### Community 3 - "Customers API (Nest)"
Cohesion: 0.08
Nodes (29): CustomersController, Body, Controller, Delete, Get, Param, Patch, Post (+21 more)

### Community 4 - "Help Content & Roles"
Cohesion: 0.09
Nodes (30): AppRole, HelpAdminOperationsSectionComponent, Component, Input, HelpApprovalsSectionComponent, Component, Input, HelpChildReportsSectionComponent (+22 more)

### Community 5 - "App Shell & System Notices"
Cohesion: 0.08
Nodes (14): App, appConfig, Component, NoticeType, SystemNotice, SystemNoticeService, Injectable, SystemNoticeComponent (+6 more)

### Community 6 - "Auth API (Nest)"
Cohesion: 0.10
Nodes (16): AuthController, Body, Controller, Get, Post, Req, UseGuards, AuthService (+8 more)

### Community 7 - "Portal Routing & Auth Guards"
Cohesion: 0.10
Nodes (18): appRoutes, authGuard(), mustChangePasswordGuard(), roleGuard(), RoleLandingService, Injectable, AppRoutes, NavigationService (+10 more)

### Community 8 - "Child Report Detail (UI+Policy)"
Cohesion: 0.10
Nodes (3): getChildReportUiState(), ChildReportDetailComponent, Component

### Community 9 - "Inspection Report Detail (UI)"
Cohesion: 0.07
Nodes (3): InspectionReportDetailComponent, Component, ViewChild

### Community 10 - "Nx Workspace Config"
Cohesion: 0.06
Nodes (31): cache, dependsOn, inputs, defaultBase, generators, @nx/angular:application, ^build, namedInputs (+23 more)

### Community 11 - "Auth Session & Constants"
Cohesion: 0.19
Nodes (12): jwtInterceptor(), UserProfile, CHILD_REPORT_STATUSES, CHILD_REPORT_TYPES, ENTITY_TYPES, HydrationOptions, DATA_HYDRATION_SOURCES, DataHydrationContext (+4 more)

### Community 12 - "portal_src_app_features"
Cohesion: 0.09
Nodes (32): First-Login Change Password Template, Authentication Feature Area, Offline / Connectivity State UI, Login Split-Panel Template, Account Settings & Security Template, Customer Entity, Offline Sync State (PENDING/CONFLICT/ERROR/SYNCED), Admin Customer Directory Template (+24 more)

### Community 13 - "api_src_app_export"
Cohesion: 0.11
Nodes (21): ExportController, Controller, Get, Param, Query, Req, Res, ExportModule (+13 more)

### Community 15 - "api_src_app_serial"
Cohesion: 0.12
Nodes (14): SerialNumbersController, Body, Controller, Delete, Get, Param, Patch, Post (+6 more)

### Community 16 - "api_src_app_users"
Cohesion: 0.12
Nodes (14): Body, Controller, Delete, Get, Param, Patch, Post, Req (+6 more)

### Community 17 - "portal_src_app_core"
Cohesion: 0.17
Nodes (8): LocalBatchSerialNumber, MetaRecord, OutboxStatus, SerialApprovalStatus, BatchSerialNumberLocalRepo, Injectable, DbService, Injectable

### Community 18 - "ref_dom"
Cohesion: 0.08
Nodes (25): dom, es2020, node_modules, portal/src/app/*, portal/src/environments/*, tmp, compileOnSave, compilerOptions (+17 more)

### Community 19 - "api_src_app_inspection"
Cohesion: 0.11
Nodes (7): CreateInspectionReportDto, IsNotEmpty, IsString, InspectionReportsService, Injectable, PrismaService, Injectable

### Community 20 - "portal_src_app_features"
Cohesion: 0.15
Nodes (16): APP_ROLES, BATCH_STATUSES, BatchStatus, EntityType, SERIAL_DISPOSITIONS, SERIAL_STATUSES, SerialStatus, SYNC_STATES (+8 more)

### Community 21 - "api_src_app_auth"
Cohesion: 0.15
Nodes (13): AuthModule, Module, JwtStrategy, Injectable, InspectionReportsModule, Module, PrismaModule, Module (+5 more)

### Community 22 - "portal_src_app_features"
Cohesion: 0.17
Nodes (5): LocalCustomer, CustomerLocalRepo, Injectable, AdminCustomersService, Injectable

### Community 23 - "portal_src_app_features"
Cohesion: 0.13
Nodes (6): ChildReportType, LocalChildReport, ChildReportLocalRepo, Injectable, ChildReportsService, Injectable

### Community 24 - "portal_src_app_shared"
Cohesion: 0.11
Nodes (22): Admin Users template, User Management (create/edit/roles/sync), Customer role workspace (view reports, download docs), Customer Workspace template, Receiver role workspace (intake/setup queue), Receiver Workspace template, Supervisor role workspace (decision queue, active inspection), Supervisor Workspace template (+14 more)

### Community 25 - "portal_tsconfig"
Cohesion: 0.09
Nodes (21): angularCompilerOptions, enableI18nLegacyMessageIdFormat, strictInjectionParameters, strictInputAccessModifiers, strictTemplates, compilerOptions, emitDecoratorMetadata, isolatedModules (+13 more)

### Community 26 - "api_src_app_inspection"
Cohesion: 0.27
Nodes (11): Roles(), InspectionReportsController, Body, Controller, Get, Param, Patch, Post (+3 more)

### Community 27 - "api_src_app_workflow"
Cohesion: 0.15
Nodes (11): InspectionReportWorkflowController, TransitionRequestDto, Body, Controller, Get, Param, Post, Req (+3 more)

### Community 28 - "api_src_app_inspection"
Cohesion: 0.13
Nodes (12): RolesGuard, Injectable, ApproveBatchDto, IsArray, IsInt, IsOptional, IsString, Min (+4 more)

### Community 29 - "api_src_app_template"
Cohesion: 0.18
Nodes (9): TemplateFileStoreService, Injectable, TemplateModule, Module, TemplateService, Injectable, TemplateValidationService, Injectable (+1 more)

### Community 30 - "portal_src_app_features"
Cohesion: 0.14
Nodes (6): LocalUser, Injectable, UserLocalRepo, AdminUsersComponent, Component, ViewChild

### Community 31 - "docs_tickets_t0_1"
Cohesion: 0.11
Nodes (19): Auth UI for Demo and Dev, POST /auth/change-password, MustChangePasswordGuard, SessionService, Temporary Password Rotation Enforcement, T0.1 Baseline Hardening Plan, Default-Deny Guard, Environment Variable Config Strategy (+11 more)

### Community 32 - "portal_src_app_shared"
Cohesion: 0.11
Nodes (12): PageActionsComponent, Component, PageIdentityComponent, Component, PageLayoutComponent, Component, PageSecondaryPanelComponent, Component (+4 more)

### Community 33 - "portal_src_app_features"
Cohesion: 0.19
Nodes (5): LocalSerialNumber, InspectionReportSerialsTableComponent, Component, Input, Output

### Community 34 - "angular_animations"
Cohesion: 0.12
Nodes (17): @angular/animations, @angular/compiler, @angular/core, @angular/router, @nestjs/config, @nestjs/platform-express, dependencies, @angular/animations (+9 more)

### Community 35 - "api_src_app_template"
Cohesion: 0.13
Nodes (11): TemplateController, Body, Controller, Get, Param, Patch, Post, Req (+3 more)

### Community 36 - "api_src_app_workflow"
Cohesion: 0.15
Nodes (10): ChildReportWorkflowController, TransitionRequestDto, Body, Controller, Get, Param, Post, Req (+2 more)

### Community 37 - "api_src_app_workflow"
Cohesion: 0.19
Nodes (7): RevisionService, Injectable, DRILL_PIPE_REQUIRED_KEYS, allowedTransitionMap, CHILD_REPORT_TRANSITIONS, INSPECTION_REPORT_TRANSITIONS, isReasonRequiredForChild()

### Community 38 - "package_scripts_db_seed"
Cohesion: 0.12
Nodes (16): scripts, build:api, build:deploy, build:portal, db:generate, db:migrate, db:reset, db:seed (+8 more)

### Community 39 - "portal_src_app_features"
Cohesion: 0.15
Nodes (5): UserPreferences, AdminTemplatesComponent, Component, AdminTemplatesService, Injectable

### Community 41 - "portal_src_app_features"
Cohesion: 0.21
Nodes (4): SerialInspectionReactiveFormComponent, Component, Input, Output

### Community 43 - "api_tsconfig_app_compileroptions"
Cohesion: 0.14
Nodes (13): compilerOptions, emitDecoratorMetadata, experimentalDecorators, module, moduleResolution, outDir, target, types (+5 more)

### Community 44 - "portal_src_app_core"
Cohesion: 0.20
Nodes (6): LocalTransitionLog, TransitionLogLocalRepo, Injectable, InspectionReportTransitionHistoryComponent, Component, Input

### Community 45 - "portal_src_app_core"
Cohesion: 0.18
Nodes (5): OutboxItem, OutboxLocalRepo, Injectable, SyncDispatcherService, Injectable

### Community 46 - "portal_src_app_core"
Cohesion: 0.19
Nodes (4): ConnectivityService, Injectable, AuthRequiredComponent, Component

### Community 48 - "portal_src_app_core"
Cohesion: 0.18
Nodes (9): ChildReportStatus, REPORT_STATUSES, ActionState, Banner, ChildReportUiPolicyContext, ChildReportUiState, TransitionOption, SupervisorWorkspaceComponent (+1 more)

### Community 49 - "portal_src_app_features"
Cohesion: 0.23
Nodes (3): InspectionReportListComponent, Component, Input

### Community 50 - "angular_build"
Cohesion: 0.18
Nodes (11): @angular/build, @angular-devkit/core, @nestjs/schematics, @nx/eslint, @nx/workspace, devDependencies, @angular/build, @angular-devkit/core (+3 more)

### Community 51 - "portal_src_app_features"
Cohesion: 0.22
Nodes (8): ValidationIssue, ValidationResult, InspectionReportTransitionActionComponent, SelectedTransition, TransitionChoice, Component, Input, Output

### Community 52 - "portal_src_app_features"
Cohesion: 0.22
Nodes (4): InspectionReportReworkStatusComponent, Component, Input, Output

### Community 54 - "portal_tsconfig_app_compileropti"
Cohesion: 0.18
Nodes (10): compilerOptions, outDir, types, exclude, extends, include, src/**/*.ts, ./tsconfig.json (+2 more)

### Community 55 - "api_src_app_app"
Cohesion: 0.27
Nodes (5): AppController, Controller, Get, AppService, Injectable

### Community 56 - "docs_tickets_f0_1"
Cohesion: 0.20
Nodes (10): DbService (per-tenant IndexedDB partitioning), Stale-While-Revalidate Pattern, SyncOrchestratorService, Per-Tenant DB Partitioning, Tenant Isolation & Online Revalidation, Inspection Report Creation MVP, IR_CREATE Outbox Operation, InspectionReportLocalRepo (+2 more)

### Community 57 - "docs_tickets_f0_2"
Cohesion: 0.20
Nodes (10): Inspection Data Entry MVP (Offline-First), inspectionData JSON Column, SN_UPDATE_INSPECTION Operation, Disposition (inspectionData.disposition), Disposition + Pending Approval Gating, Disposition Mismatch Trap, Prisma + Postgres Stack, inspectionData as JSONB (template flexibility) (+2 more)

### Community 60 - "docs_tickets_f0_1"
Cohesion: 0.22
Nodes (9): Admin User Management MVP, Admin Customers MVP (Offline-First), Customer Prisma Model, Optimistic Concurrency Control (version field), Serial Numbers MVP (Offline-First), AuditLog, Reopen Requires Reason + Snapshot, Snapshot Revisions (InspectionReportRevision, ChildReportRevision) (+1 more)

### Community 61 - "docs_tickets_f0_2"
Cohesion: 0.22
Nodes (9): InspectionReport, Template Binding (DRILL_PIPE_REPORT), Drill Pipe v1 Schematic Fields, Chunked Export (10-item .xlsx / .zip), Export Snapshot (Approved-Only, Online-Only), Export UI Integration MVP, T0.2 Changes, schema.prisma (+1 more)

### Community 62 - "portal_src_app_core"
Cohesion: 0.36
Nodes (7): apiErrorInterceptor(), ErrorPayload, ErrorPayloadObject, extractBackendErrorMessage(), extractRecordMessages(), joinMessages(), withNormalizedHttpErrorMessage()

### Community 63 - "portal_src_app_core"
Cohesion: 0.36
Nodes (3): LocalInspectionApprovalBatch, ApprovalBatchLocalRepo, Injectable

### Community 65 - "portal_src_app_core"
Cohesion: 0.31
Nodes (3): OutboxService, Injectable, AppSyncState

### Community 66 - "api_project_build_configurations"
Cohesion: 0.25
Nodes (8): configurations, development, production, args, buildTarget, buildTarget, configurations, --node-env=development

### Community 67 - "api_project_copy_workspace"
Cohesion: 0.25
Nodes (8): dependsOn, build, dependsOn, continuous, defaultConfiguration, dependsOn, executor, serve

### Community 68 - "api_src_app_inspection"
Cohesion: 0.25
Nodes (8): CreateApprovalBatchDto, IsArray, IsInt, IsNotEmpty, IsOptional, IsString, Min, IsUUID

### Community 69 - "api_src_app_inspection"
Cohesion: 0.25
Nodes (7): ReturnBatchDto, IsArray, IsInt, IsNotEmpty, IsOptional, IsString, Min

### Community 70 - "api_tsconfig"
Cohesion: 0.25
Nodes (7): compilerOptions, esModuleInterop, extends, files, include, ../tsconfig.base.json, references

### Community 71 - "docs_tickets_f0_1"
Cohesion: 0.25
Nodes (8): AdminUsersComponent, AdminUsersService, Atomic Temporal ID Remapping, 409 Conflict Halt Strategy, OutboxService, Read-Through Cache Pattern, UserLocalRepo, Write-Through Outbox Pattern

### Community 73 - "portal_src_app_core"
Cohesion: 0.29
Nodes (7): ReportStatus, ActionState, Banner, getInspectionReportUiState(), InspectionReportUiState, TransitionOption, UiPolicyContext

### Community 74 - "portal_src_app_core"
Cohesion: 0.39
Nodes (3): LocalInspectionReport, InspectionReportLocalRepo, Injectable

### Community 76 - "portal_src_app_features"
Cohesion: 0.25
Nodes (5): HelpComponent, Component, HelpContentService, ROLE_HELP_DEFINITIONS, Injectable

### Community 77 - "api_project_build_executor"
Cohesion: 0.29
Nodes (7): executor, options, args, command, cwd, build, --node-env=production

### Community 78 - "api_src_app_app"
Cohesion: 0.29
Nodes (4): AppModule, Module, AllExceptionsFilter, Catch

### Community 79 - "docs_tickets_f0_1"
Cohesion: 0.33
Nodes (7): Postgres Service (Docker), F0.1.1 Portal Shell + Navigation, ShellComponent, Angular Portal, NestJS API, OTS Monorepo, Prisma ORM

### Community 80 - "docs_tickets_f0_2"
Cohesion: 0.29
Nodes (7): pendingTransitionToStatus Optimistic State, Role-Based Transition Matrix, Workflow Transitions UI (Offline-First), DRILL_PIPE_FIELDS, InspectionReportWorkflowService, PENDING_APPROVAL Server-Authoritative Gating, Authoritative State Transition Matrix

### Community 81 - "docs_tickets_t0_2"
Cohesion: 0.29
Nodes (7): T0.2 Database Operational Baseline Plan, PrismaService / PrismaModule, provision-tenant.ts Script, Tenant Isolation (tenantId scoping), WSL Docker Named Volume Approach, Named Volume over NTFS Bind Mount, T0.2 Validation

### Community 82 - "portal_src_app_features"
Cohesion: 0.33
Nodes (3): TEMPLATE_KEYS, CreateInspectionReportComponent, Component

### Community 85 - "portal_src_app_features"
Cohesion: 0.29
Nodes (4): InspectionReportApprovalBatchesComponent, Component, Input, Output

### Community 86 - "portal_src_app_features"
Cohesion: 0.38
Nodes (5): DRILL_PIPE_V1_SCHEMA, FieldInputType, FieldSchema, FormSchema, SectionSchema

### Community 87 - "portal_src_app_shared"
Cohesion: 0.29
Nodes (7): Page Actions primitive, Page Identity primitive (title/subtitle strip), Page Layout primitive (page shell container), Page layout composition system, Page Secondary Panel primitive, Page Summary primitive (operational summary), Page Workspace primitive (main workspace card)

### Community 88 - "api_project"
Cohesion: 0.33
Nodes (5): name, projectType, $schema, sourceRoot, tags

### Community 89 - "api_project_prune_dependson"
Cohesion: 0.33
Nodes (6): dependsOn, executor, targets, prune, copy-workspace-modules, prune-lockfile

### Community 90 - "api_project_prune_lockfile"
Cohesion: 0.33
Nodes (6): cache, executor, outputs, prune-lockfile, {workspaceRoot}/dist/api/package.json, {workspaceRoot}/dist/api/package-lock.json

### Community 91 - "api_scripts_seed"
Cohesion: 0.53
Nodes (5): main(), prisma, provisionNobleCorporation(), provisionRolesForTenant(), provisionTenant()

### Community 93 - "portal_src_app_features"
Cohesion: 0.33
Nodes (5): SerialDisposition, InspectionReportKpiOverviewComponent, Component, Input, Output

### Community 95 - "portal_src_app_features"
Cohesion: 0.33
Nodes (4): InspectionReportHeaderComponent, Component, Input, Output

### Community 96 - "api_project_copy_workspace"
Cohesion: 0.40
Nodes (5): cache, executor, outputs, copy-workspace-modules, {workspaceRoot}/dist/api/workspace_modules

### Community 97 - "api_project_copy_workspace"
Cohesion: 0.40
Nodes (5): options, buildTarget, runBuildTargetDependencies, options, options

### Community 98 - "docs_tickets_f0_1"
Cohesion: 0.40
Nodes (5): AdminCustomersService, CustomerLocalRepo, LocalCustomer (syncState model), SyncDispatcherService, child-report-local.repo.ts

### Community 99 - "docs_tickets_f0_3"
Cohesion: 0.40
Nodes (5): SerialNumber, Serial Uniqueness Constraint (tenantId, inspectionReportId, serial), ChildReport, Child Reports MVP (Offline-First), Idempotent POST via Client-Supplied UUID

### Community 100 - "package"
Cohesion: 0.40
Nodes (4): license, name, private, version

### Community 101 - "portal_ngsw_config"
Cohesion: 0.40
Nodes (4): assetGroups, dataGroups, index, $schema

### Community 102 - "portal_src_app_features"
Cohesion: 0.40
Nodes (3): LoginComponent, Component, ViewChild

### Community 103 - "portal_src_app_features"
Cohesion: 0.40
Nodes (4): InspectionBanner, InspectionReportBannersComponent, Component, Input

### Community 104 - "portal_src_app_shared"
Cohesion: 0.40
Nodes (3): BadgeSeverity, StatusBadgeComponent, Component

### Community 105 - "scripts_sync_portal_version"
Cohesion: 0.40
Nodes (3): outputPath, packageJsonPath, root

### Community 107 - "portal_src_app_features"
Cohesion: 0.50
Nodes (3): HelpAccountSettingsSectionComponent, Component, Input

## Knowledge Gaps
- **354 isolated node(s):** `prisma`, `name`, `$schema`, `sourceRoot`, `projectType` (+349 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **82 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `angular_animations` to `class_transformer`, `class_validator`, `exceljs`, `form_data`, `nestjs_common`, `nestjs_core`, `api_src_app_export`, `nestjs_jwt`, `nestjs_passport`, `package_dependencies_passport`, `package_dependencies_passport_jw`, `package_dependencies_prisma_clie`, `package_dependencies_reflect_met`, `package`, `angular_common`, `angular_devkit_build_angular`, `angular_forms`, `angular_platform_browser`, `angular_platform_browser_dynamic`, `angular_service_worker`, `axios`, `bcrypt`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Why does `jszip` connect `api_src_app_export` to `angular_animations`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Why does `PrismaService` connect `api_src_app_inspection` to `Child Reports API (Nest)`, `Customers API (Nest)`, `api_src_app_template`, `api_src_app_workflow`, `Auth API (Nest)`, `api_src_app_workflow`, `api_src_app_export`, `api_src_app_serial`, `api_src_app_users`, `api_src_app_auth`, `api_src_app_workflow`, `api_src_app_template`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **What connects `prisma`, `name`, `$schema` to the rest of the system?**
  _354 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Child Reports API (Nest)` be split into smaller, more focused modules?**
  _Cohesion score 0.06262626262626263 - nodes in this community are weakly interconnected._
- **Should `API Reference Docs` be split into smaller, more focused modules?**
  _Cohesion score 0.058673469387755105 - nodes in this community are weakly interconnected._
- **Should `Portal Build Config (Nx)` be split into smaller, more focused modules?**
  _Cohesion score 0.04343971631205674 - nodes in this community are weakly interconnected._