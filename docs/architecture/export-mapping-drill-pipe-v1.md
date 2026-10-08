# Export Mapping: DRILL_PIPE_REPORT v1

This document outlines the Excel export mapping rules for the `DRILL_PIPE_REPORT` template (version 1) in the OTS system.

## Data Source
All data for the export is sourced **strictly** from the `snapshotJson` of an **APPROVED** `InspectionReportRevision`. 
Live database rows are not queried for report content to ensure **100% determinism** and historical accuracy.

## Multi-Part ZIP Export Behavior (T0.5.4)
To prevent "capacity exceeded" errors when exporting inspection reports with large numbers of serial numbers, the system enforces a strict chunking rule:

1. **Limit**: A single Excel file will contain a **maximum of 10 Serial Numbers**.
2. **Behavior**:
   - If `$N \le 10$`: The API returns a direct Excel download (`.xlsx`).
   - If `$N > 10$`: The API returns a ZIP archive (`.zip`) containing multiple `.xlsx` parts.
3. **Naming Convention**:
   - Single Excel: `InspectionReport_<id>_rev<revision>.xlsx`
   - ZIP Archive: `InspectionReport_<id>_rev<revision>.zip`
   - Parts inside ZIP: `InspectionReport_<id>_rev<revision>_part<k>of<n>.xlsx` (where $k$ starts at 1)

**Determinism**: The chunking and ordering of serial numbers inside the parts exactly matches the array order in the approved `snapshotJson`.

## Header Mappings
The headers are mapped to the first worksheet and repeated for every chunk part (if ZIP export):

| Field | Source (`snapshotJson` path) | Cell Range | Notes |
| :--- | :--- | :--- | :--- |
| Customer | `customer` | `B5` | |
| Report No | `reportNumber` | `V5` | |
| Date | `date` | `V4` | Formatted as Date |
| Work Order | `workOrder` | `V6` | |
| Inspection Method | (Static / Snapshot) | `B7` | Defaults to "100% Visual / Dimensional / MPI" |

## Serial Table Mappings
The serial number table starts at row **15**. Due to the strict multi-part rule, a maximum of 10 rows (15 to 24) will be populated per Excel file.

| Field | Source | Excel Column | Behavior |
| :--- | :--- | :--- | :--- |
| Serial Number | `serialNumbers[i].serialNumber` | `A` | String value |
| Disposition Mappings | `serialNumbers[i].disposition` | | See below |

### Disposition Mapping Strategy
The export places an `X` in specific columns based on the disposition enum:

- **`PASS`**: Mapped to `AD` (Premium).
- **`REWORK`**: Mapped to `AE` (Class 2).
- **`SCRAP`**: Mapped to `AF` (Scrap).
- **`HOLD`**: **NOT SUPPORTED**. If a serial number is marked as `HOLD`, the API will intentionally throw a `400 Bad Request` ("Template does not support HOLD disposition"). The system will deliberately reject the export rather than silently ignoring the value.

> [!WARNING]
> The template does not currently provide a column for `HOLD` items. Therefore, `HOLD` items cannot be exported using the `DRILL_PIPE_REPORT` v1 template.
