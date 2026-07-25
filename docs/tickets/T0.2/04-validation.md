# 04 Validation

## 1. Local Postgres (WSL)

**Command**: `wsl docker compose ps`
**Result**: Container `ots_postgres` running on port `0.0.0.0:5432`.

## 2. API Connectivity & Migration

**Command**: `npm run db:migrate`
**Result**: Migration applied successfully.

## 3. Provisioning

**Command**: `npm run db:provision "Acme Corp" "admin@acme.com"`
**Result**:

```json
{
  "name": "Acme Corp",
  "users": [
    {
      "email": "admin@acme.com",
      "role": "ADMIN"
    }
  ]
}
```

**Conclusion**: API (Windows) successfully connected to DB (WSL), wrote data, and read key constraints. The schema now uses `InspectionReport` instead of `IR`.
