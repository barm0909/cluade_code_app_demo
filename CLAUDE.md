# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

This repo contains a single app, `inventory-app/` (a Japanese-language food inventory management SPA). All commands below must be run from that directory:

```bash
cd inventory-app
```

`docs/warehouse-feature.md` (repo root) documents the warehouse/multi-location feature in Japanese and is kept in sync with `useInventory.ts`/`App.tsx` — update it when warehouse behavior changes. `docs/dashboard-feature.md` does the same for the ダッシュボード tab (`DashboardView.tsx` + its aggregation functions in `useInventory.ts`), and `docs/fefo-feature.md` for FEFO出庫 (`ShipFefoModal.tsx` + `planFefoShipment`/`shipFefo`).

## Commands

```bash
npm run dev            # start Vite dev server (proxies /api → localhost:8787)
npm run dev:api         # wrangler dev — Worker API + local D1 (run alongside npm run dev)
npm run build            # tsc -b (typecheck incl. worker) then vite build
npm run lint              # oxlint
npm run test               # vitest run (single run, CI mode)
npm run test:watch          # vitest watch mode
npm run test:coverage        # vitest run --coverage (v8 provider)

npm run db:migrate           # apply migrations/ to the LOCAL D1 (.wrangler/state)
npm run db:migrate:remote     # apply migrations to the REMOTE D1 (needs wrangler login)
npm run db:seed                # load seed.sql into the local D1 (re-runnable)
npm run db:query -- "SQL"       # run arbitrary SQL against the local D1
```

Run a single test file: `npx vitest run src/test/warehouse.test.ts`
Run a single test by name: `npx vitest run -t "test name substring"`

There is no separate typecheck script — `npm run build` runs `tsc -b` as its first step, so a failing build often means a type error rather than a bundling error.

Note that `npm run test` and `npm run lint` do not type-check (Vitest transforms TS without full type-checking and oxlint's `typeAware` option is off), so don't assume the build is green just because tests/lint pass — run `npm run build` (or `tsc -b` directly) to verify types.

## Architecture

React 19 + TypeScript + Vite SPA with a thin Cloudflare Worker backend (`worker/index.ts`) that persists all state to **D1** (SQLite). The same `DB` binding resolves to a local SQLite file under `.wrangler/state/` during `wrangler dev` and to the remote Cloudflare D1 database once deployed — the Worker code is identical in both.

- `wrangler.jsonc` is the single config for both local dev and deploy (`main` worker + `assets` + `d1_databases`). The `database_id` is a placeholder until someone runs `npx wrangler d1 create inventory-db` and pastes the real id — `wrangler deploy` fails until then. Changing `database_id` also re-keys the local D1 state, so re-run `npm run db:migrate && npm run db:seed` after touching it.
- Local dev needs two processes: `npm run dev` (Vite, HMR) and `npm run dev:api` (Worker + local D1 on :8787); Vite proxies `/api` to the latter. `wrangler dev` requires `dist/` to exist (run `npm run build` once).
- DB schema lives in `migrations/` (`0001_init.sql`: `products`, `lots`, `warehouses`, `stock_transactions`; `0002_categories.sql`: `categories` + `products.category_id` — a normalized form of the `useInventory.ts` model, snake_case columns). `seed.sql` mirrors `SAMPLE_DATA` / `DEFAULT_CATEGORIES`. Keep all three in sync when the data model changes, and keep the worker's local type copies in `worker/index.ts` in sync too (it can't import `useInventory.ts` because that would pull react/xlsx into the Worker bundle).

### State lives in one hook: `useInventory.ts`

Everything — types, sample data, persistence, and all mutations — is defined in `src/useInventory.ts`, not spread across a `types.ts`/store/reducer split. `App.tsx` and the modal components import their types (`Product`, `Lot`, `Warehouse`, `StockTransaction`, `SortField`, etc.) directly from `./useInventory`.

- `src/types.ts` is a **stale leftover** from an earlier version of the data model (it lacks `lots`, `costPrice`, warehouses) and is not imported anywhere. Don't add new types there — extend `useInventory.ts` instead, or delete `types.ts` if you're cleaning up.

Persistence is slice-based via the Worker API: `GET /api/state` returns everything on mount; each mutation fire-and-forgets a full-replace `PUT /api/products` / `/api/warehouses` / `/api/categories` / `/api/ledger` (see `persist()` in `useInventory.ts`). There is no localStorage anymore. When the API is unreachable (offline, jsdom tests), the hook runs purely in memory, starting from `SAMPLE_DATA` / `DEFAULT_WAREHOUSES` / `DEFAULT_CATEGORIES` — that fallback is what most tests rely on; tests that verify persistence stub `fetch` with `src/test/mockApi.ts`. A fresh (empty) remote DB shows an empty inventory until リセット (`resetToSample()`) is clicked, which PUTs the sample data; the local DB is instead populated by `npm run db:seed`.

### Data model

- `Product` has many `Lot`s (lot-level tracking by expiry date and warehouse), not a single quantity field. `totalQuantity(product)` and `totalQuantityByWarehouse(product, warehouseId)` sum across lots.
- Every `Lot` has a `warehouseId`. Loading old data without `warehouseId` migrates it to `DEFAULT_WAREHOUSE_ID` (`wh-sales`) — preserve this backward-compat mapping in `migrateProducts()` if you touch it.
- `Product.categoryId` references the `categories` master (`Category { id, name }`, managed via `addCategory`/`updateCategory`/`deleteCategory`; delete is blocked while any product uses the category). Renaming a category propagates everywhere because products hold the id, not the name. Loading old data with a legacy `category` string maps it to an existing category by name (or creates one, falling back to `未分類`) in `migrateProducts()`.
- Any quantity-changing operation (`addLot`, `adjustLotQuantity`, `moveLot`, `shipFefo`, `importExcel`, `applyStocktake`) also appends to the `ledger` via `addTransaction` (or `addTransactions` for batches like 棚卸, which records all rows in one state update / one PUT), recording it as `入庫`/`出庫`/`移動`. If you add a new mutation that changes stock, wire it into the ledger the same way so 入出庫帳票 stays accurate.
- `shipFefo(productId, quantity, options?)` is the product-level出庫: it ships from the earliest-expiring lots first (FEFO). The allocation itself is the pure `planFefoShipment(product, quantity, options)`, which `ShipFefoModal` also uses for its live preview — keep the two sharing that function so the preview can't diverge from what actually ships. Expired lots are excluded unless `includeExpired` is set, and one ledger row is written per allocated lot. See `docs/fefo-feature.md`.
- `moveLot` full-quantity moves just update the lot's `warehouseId` in place; partial moves shrink the source lot and create a new lot (new id, same `lotNo`) in the target warehouse, then record both an outgoing and incoming ledger transaction.

### Component structure

- `App.tsx` — single top-level component holding all UI state (filters, sort, modals, active tab) and rendering the product/lot table plus the ledger tab. Product rows expand inline to show a nested lot table.
- `ProductModal.tsx` / `LotModal.tsx` — controlled create/edit forms for products and lots, taking `onSave`/`onClose` props; App.tsx decides whether `onSave` calls the `add*` or `update*` mutator based on whether it's editing `null`/`'new'` vs an existing record.
- `MoveLotModal` / `StockIoModal` — defined inline inside `App.tsx` (not separate files) since they're tightly coupled to the lot table's row actions.
- `ShipFefoModal.tsx` — the FEFO出庫 form opened from a product row (not a lot row). It renders a live allocation preview from `planFefoShipment` and blocks submission while `shortage > 0`; `App.tsx` reports the executed plan through `notify`.
- `LedgerView.tsx` — read-only table rendering the transaction ledger, resolving warehouse ids to names/colors via the `warehouses` list. It owns the ledger filter state (keyword / date range / type / warehouse) locally; the filtering, totals and CSV serialization themselves are pure functions in `useInventory.ts` (`filterLedger`, `ledgerTotals`, `ledgerCsv`, `exportLedgerCsv`) so they can be tested without rendering (`src/test/ledger.test.ts`).
- `ProductMasterView.tsx` / `CategoryMasterView.tsx` — inline-edit master tables, both rendered in the 商品マスタ tab (products first, categories below).
- `StocktakeView.tsx` — 棚卸 tab. One row per lot with the book quantity and an 実数 input; counts live in local state keyed by `lotId` (absent key = uncounted) and are only written back when 棚卸を確定 calls `applyStocktake`. Like `LedgerView`, all the logic is pure functions in `useInventory.ts` (`stocktakeRows`, `stocktakeDiffs`, `stocktakeTotals`, `stocktakeCsv`, `exportStocktakeCsv`) tested in `src/test/stocktake.test.ts`. `applyStocktake` deliberately ignores the view's filter and applies every entry in `counts`, so changing the filter mid-count never drops input.
- `DashboardView.tsx` — ダッシュボード tab (first tab; 在庫一覧 is still the default). Read-only summary of stock value, 要発注 (`totalQuantity <= minQuantity`), expiry alerts, and per-warehouse / per-category breakdowns. Its only local state is the expiry threshold (7/14/30 days); every aggregation is a pure function in `useInventory.ts` (`dashboardTotals`, `lowStockRows`, `expiringLotRows`, `warehouseSummaries`, `categorySummaries`, `lowStockCsv`, `exportLowStockCsv`) tested in `src/test/dashboard.test.ts`. App.tsx hides the shared alert banners and stats row on this tab to avoid duplicating them. See `docs/dashboard-feature.md`.
- `badges.tsx` — the shared `ExpiryBadge` / `WarehouseDot` presentational components used by both the inventory table and the stocktake table. `ExpiryBadge` switches to a plain date past 7 days, so `DashboardView` uses its own `DaysLeftBadge` for the wider 14/30-day ranges.
- `NumberInput.tsx` — the shared `<input type="number">` wrapper used by every numeric form field (数量 / 最低在庫数 / 価格 …). It keeps the typed text in local state so clearing the field leaves it empty and reports `0` (or `emptyValue`) to the parent. **Don't write `value={someNumber} onChange={e => set(+e.target.value)}` directly** — `+'' === 0` is re-rendered into the field, so backspace looks broken on the last digit. (`StocktakeView`'s 実数 column is exempt: its counts are string-keyed and an empty value means 未カウント.)
- `ConfirmDialog.tsx` / `useConfirm.tsx` — in-app replacements for `window.confirm` / `window.alert`. Use `const { confirm, confirmDialog } = useConfirm()` (or `useNotify`) and render the returned node; **don't call the native `confirm`/`alert`** — they are silently suppressed in embedded browsers and in tabs where the user checked "don't show more dialogs", which makes the button look dead. The two files are split because a file exporting both a component and hooks breaks React Fast Refresh (oxlint `react(only-export-components)`).
- Excel import/export and CSV export (`exportCsv`, `exportExcel`, `importExcel` in `useInventory.ts`) use the `xlsx` package. Import matches rows by `SKU` + `ロットNo`(lot number) and only touches matching lots' quantities, diffing against current quantity to decide 入庫 vs 出庫 and by how much.
- There are four different CSV exports (在庫一覧 / 入出庫帳票 / 棚卸表 / 要発注リスト). Their button labels, tooltips and download filenames all come from `CSV_EXPORTS` + `csvFileName` / `csvExportLabel` / `csvExportHint` in `useInventory.ts` so the four stay distinguishable — add a new key there rather than hard-coding a filename or a bare 「CSVエクスポート」 label at the call site.

### Testing

Vitest + Testing Library + jsdom (`vite.config.ts` sets `environment: 'jsdom'`, `setupFiles: './src/test/setup.ts'`). Tests live in `src/test/`, one file per concern (`useInventory.test.ts`, `warehouse.test.ts`, `stocktake.test.ts`, `dashboard.test.ts`, `exportCsv.test.ts`, `exportExcel.test.ts`, `importExcel.test.ts`, `LotModal.test.tsx`, `ProductModal.test.tsx`, `utils.test.ts`). When adding a mutator or utility to `useInventory.ts`, add its tests to the matching existing file rather than creating a new one, unless it's a genuinely new concern (as `warehouse.test.ts` was for the warehouse feature).

### Linting

`oxlint` (not ESLint) via `.oxlintrc.json`, with `react`, `typescript`, and `oxc` plugins enabled. Type-aware rules are off by default (see `README.md` for how to enable `typeAware` if needed).
