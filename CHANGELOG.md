# Changelog

## v0.4.0 — 2026-07-13

### Major Updates
- **E-invoice PINT-AE compliance** — aligned XML with 2025-Q2 UAE spec
- **Emirate code normalization** — auto-remaps legacy AE-xx codes to PINT-AE 3-letter
- **Offline backup & restore** — full local disk file storage with one-click restore
- **Nested folders in My Files** — organize documents in folder hierarchy
- **Apache-2.0 relicensing** — open source friendly license
- **Bank accounts overhaul** — draggable, advances, improved UI
- **Declaration letter improvements** — better formatting and data flow
- **Reports overhaul** — major rework of financial and inventory reports (1700+ lines)
- **Local-mode fixes** — text↔number coercion matching PostgREST behavior

### Removed
- Old licensing system (replaced with simpler model)
- Sync engine (replaced with local-first approach)
- Insights module (integrated into dashboard)
- Tesseract WASM files (moved to cloud processing)
- VYAPAR_ANALYSIS.md (archived)

### Infrastructure
- Stripe function updates for billing
- Supabase schema cleanup
- Test suite restructured

---

## v0.3.0 — Previous release
- CRM credit limits + opening balances
- Receivable/Payable KPI cards
- Round-off + per-line discount %
- Vyapar-parity phase 1: payment terms, dates, words, credit fields
- Low-stock alert fix