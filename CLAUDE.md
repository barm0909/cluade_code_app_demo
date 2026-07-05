# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

This repo contains a single app, `inventory-app/` (a Japanese-language food inventory management SPA). All commands below must be run from that directory:

```bash
cd inventory-app
```

`docs/warehouse-feature.md` (repo root) documents the warehouse/multi-location feature in Japanese and is kept in sync with `useInventory.ts`/`App.tsx` — update it when warehouse behavior changes.

## Commands

```bash
npm run dev            # start Vite dev server
npm run build           # tsc -b (typecheck) then vite build
npm run lint             # oxlint
npm run test              # vitest run (single run, CI mode)
npm run test:watch        # vitest watch mode
npm run test:coverage      # vitest run --coverage (v8 provider)
```

Run a single test file: `npx vitest run src/test/warehouse.test.ts`
Run a single test by name: `npx vitest run -t "test name substring"`

There is no separate typecheck script — `npm run build` runs `tsc -b` as its first step, so a failing build often means a type error rather than a bundling error.

Note that `npm run test` and `npm run lint` do not type-check (Vitest transforms TS without full type-checking and oxlint's `typeAware` option is off), so don't assume the build is green just because tests/lint pass — run `npm run build` (or `tsc -b` directly) to verify types.

## Architecture

This is a client-only React 19 + TypeScript + Vite SPA with **no backend**. All state is persisted to `localStorage` and re-hydrated on load.

### State lives in one hook: `useInventory.ts`

Everything — types, sample data, persistence, and all mutations — is defined in `src/useInventory.ts`, not spread across a `types.ts`/store/reducer split. `App.tsx` and the modal components import their types (`Product`, `Lot`, `Warehouse`, `StockTransaction`, `SortField`, etc.) directly from `./useInventory`.

- `src/types.ts` is a **stale leftover** from an earlier version of the data model (it lacks `lots`, `costPrice`, warehouses) and is not imported anywhere. Don't add new types there — extend `useInventory.ts` instead, or delete `types.ts` if you're cleaning up.

Three localStorage keys, each independently loaded/saved/versioned:
- `inventory_products_v2` — the product/lot catalog
- `inventory_ledger_v1` — the stock transaction ledger (入出庫帳票)
- `inventory_warehouses_v1` — warehouse definitions

On first load (or missing key), each is seeded with defaults (`SAMPLE_DATA`, `[]`, `DEFAULT_WAREHOUSES`) and immediately written back to localStorage. `resetToSample()` clears all three keys and restores these defaults.

### Data model

- `Product` has many `Lot`s (lot-level tracking by expiry date and warehouse), not a single quantity field. `totalQuantity(product)` and `totalQuantityByWarehouse(product, warehouseId)` sum across lots.
- Every `Lot` has a `warehouseId`. Loading old data without `warehouseId` migrates it to `DEFAULT_WAREHOUSE_ID` (`wh-sales`) — preserve this backward-compat mapping in `load()` if you touch it.
- Any quantity-changing operation (`addLot`, `adjustLotQuantity`, `moveLot`, `importExcel`) also appends to the `ledger` via `addTransaction`, recording it as `入庫`/`出庫`/`移動`. If you add a new mutation that changes stock, wire it into the ledger the same way so 入出庫帳票 stays accurate.
- `moveLot` full-quantity moves just update the lot's `warehouseId` in place; partial moves shrink the source lot and create a new lot (new id, same `lotNo`) in the target warehouse, then record both an outgoing and incoming ledger transaction.

### Component structure

- `App.tsx` — single top-level component holding all UI state (filters, sort, modals, active tab) and rendering the product/lot table plus the ledger tab. Product rows expand inline to show a nested lot table.
- `ProductModal.tsx` / `LotModal.tsx` — controlled create/edit forms for products and lots, taking `onSave`/`onClose` props; App.tsx decides whether `onSave` calls the `add*` or `update*` mutator based on whether it's editing `null`/`'new'` vs an existing record.
- `MoveLotModal` — defined inline inside `App.tsx` (not a separate file) since it's tightly coupled to the lot table's row actions.
- `LedgerView.tsx` — read-only table rendering the transaction ledger, resolving warehouse ids to names/colors via the `warehouses` list.
- Excel import/export and CSV export (`exportCsv`, `exportExcel`, `importExcel` in `useInventory.ts`) use the `xlsx` package. Import matches rows by `SKU` + `ロットNo`(lot number) and only touches matching lots' quantities, diffing against current quantity to decide 入庫 vs 出庫 and by how much.

### Testing

Vitest + Testing Library + jsdom (`vite.config.ts` sets `environment: 'jsdom'`, `setupFiles: './src/test/setup.ts'`). Tests live in `src/test/`, one file per concern (`useInventory.test.ts`, `warehouse.test.ts`, `exportCsv.test.ts`, `exportExcel.test.ts`, `importExcel.test.ts`, `LotModal.test.tsx`, `ProductModal.test.tsx`, `utils.test.ts`). When adding a mutator or utility to `useInventory.ts`, add its tests to the matching existing file rather than creating a new one, unless it's a genuinely new concern (as `warehouse.test.ts` was for the warehouse feature).

### Linting

`oxlint` (not ESLint) via `.oxlintrc.json`, with `react`, `typescript`, and `oxc` plugins enabled. Type-aware rules are off by default (see `README.md` for how to enable `typeAware` if needed).
