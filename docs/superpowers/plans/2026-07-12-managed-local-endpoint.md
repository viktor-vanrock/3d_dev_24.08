# Managed-local Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Store an owner-scoped normalized LAN `host:port` for `user_printers` with `link_source='ip'`, without server-side network access.

**Architecture:** Add one nullable endpoint column and integrity checks to the existing `user_printers` table. Extend the existing `/me/printers` contract with strict parsing and owner-filtered reads; public catalog queries remain unchanged. Prove validation, isolation, and no-fetch behavior with API tests.

**Tech Stack:** PostgreSQL/dbmate, Fastify, TypeScript, Vitest.

## Global Constraints

- Store only normalized `host:port`; reject URL paths, query, fragments, credentials, and non-LAN endpoints.
- The API must never fetch, proxy, or poll the LAN endpoint.
- Endpoint data is visible only to the owning account and never in public `/printers*` responses.

### Task 1: Schema and API contract

**Files:**
- Create: `apps/api/db/migrations/20260712160000_user_printer_lan_endpoint.sql`
- Modify: `apps/api/src/profile/activation.ts`
- Test: `apps/api/src/profile/activation.test.ts`

- [ ] Add nullable `lan_endpoint` plus checks/index, and update the dbmate schema snapshot.
- [ ] Accept `lan_endpoint` only with `link_source='ip'`, normalize host casing/default port, reject unsafe input, and select it only through owner-scoped `/me/printers` queries.
- [ ] Add roundtrip, invalid endpoint, owner isolation, and no-network-call tests.
- [ ] Run migration checks, targeted tests, typecheck, lint, and build.
