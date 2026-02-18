# OTS

Monorepo containing the Angular Portal and NestJS API.

## Structure

- **Portal**: Angular application (`/portal`)
- **API**: NestJS application (`/api`)

## Prerequisites

- **Node.js**: v20.19.3 (Required)

## Setup

```bash
npm install
```

## Development

Run the API and Portal in parallel terminals.

### NestJS API

```bash
npm run start:api
```

### Angular Portal

```bash
npm run start:portal
```

## Build & Quality

```bash
# Build API
npm run build:api

# Build Portal
npm run build:portal

# Lint all projects
npm run lint

# Visualise dependency graph
npm run graph
```
