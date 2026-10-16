# Agent run notes

**Run:** 16 Oct 2026, Claude Code (Claude Opus 5.5), 68 trace steps, 6 proposals.
**Method:** investigated only through `tools/cli.ts`. `planted.json` and the raw JSON were opened only after step 68.

## Important caveat

The same Claude Code session generated the synthetic data, planted the leaks and then ran as the agent. The agent was therefore **not blind**: it knew roughly where the leaks were. What the run does show:
- every number comes from deterministic tools;
- every proposal is backed by logged evidence and a counter-check;
- impacts can't be typed by hand.

What it does *not* show is unsupervised discovery. The real test is a dataset the agent has never seen.

## Scorecard vs `planted.json`

| # | Planted leak | Found? | Agent's action | Notes |
|---|---|---|---|---|
| 1 | Wrap dress M/L fit | Yes (steps 8, 16–20) | P-001 pause M/L + fit-spec email; style kept | Also found that pausing M/L is about CM-neutral on an incremental basis (−$1.5k/yr); the value is in the fix. |
| 2 | $50 free-shipping threshold | Yes (steps 12, 23–32) | P-002 → $75, A/B first | Modelled 5 thresholds plus an abandon-rate stress test; chose $75 because it sits just under the cheapest full-price core item. |
| 3 | WELCOME30 cohort | Yes (steps 35–41) | P-004 → 15% split test, not killed | Measured 10% full-price conversion. The planted converter persona is 22%, but only ~50% of them repeat inside the window, so ~11% is the expected observable figure. Consistent. |
| 4 | Core M/L stockouts | Yes (steps 42–45) | P-005 two draft POs (6 lines) | Estimated 405 lost units vs a true 379 (+6.9%). Per SKU: POL-NAV-L 53 vs 44, CHN-KHA-L 85 vs 74, CHN-KHA-M 98 vs 106. The 28-day pre-outage velocity baseline is noisy and slightly high. Also flagged that a 42–51 day gap is unavoidable by sea and overlaps BFCM. |
| 5 | Decoy tee | Yes, kept (steps 21–34) | P-003 keep_with_rationale | See "partial miss" below. |
| 6 | Slow knitwear (Moss) | Yes (steps 46–51) | P-006 no reorder, January markdown | Checked against peak-season velocity so it wasn't fooled by September's seasonal low; Oatmeal correctly left alone. |

## Misses and weak spots (honest)

1. **The tee rationale didn't follow the planted story.** The plant assumed tee baskets are "highly profitable". The data shows mixed baskets with the tee average $74 CM per order, *less* than mixed baskets without it ($84), so no halo is visible. The agent kept the tee on two other grounds:
   - the breakeven halo is only 1.65%;
   - once the threshold rises to $75, cutting the tee loses money even with zero halo.

   That is defensible, but it means the "basket builder" claim is still unproven.
2. **The interaction claim was asserted before it was checked.** In step 68 the agent attributed the −$3.9k interaction "mostly" to threshold × WELCOME30. A post-run check (`scripts/interaction-check.ts`) found threshold × WELCOME30 = −$2.5k and fit fix × WELCOME30 = −$1.4k. The claim was mostly right, but it was never verified inside the run.
3. **TEE2FOR50 wasn't proposed for change.** The multi-buy runs at −12.4% CM and was spotted (step 54), but only listed as a risk on P-003, not as its own proposal.
4. **The post-fix return rate on the wrap dress (32%) is optimistic-ish.** XS/S/XL run 22–26%, but a revised grade won't land perfectly. P-001's +$67k is the largest single number, and it's the most assumption-driven one after WELCOME30.
5. **The agent changed a tool mid-run** (step 56): it added `--where` to `describe_table` to get supplier names and FOB costs for PO lines. The change was logged in the trace.

## Found but not planted

- **Slip Dress** returns 34–37% in every size, with `changed_mind` as the top reason. It is an emergent result of a high base return rate, not a planted leak. The agent correctly read it as an expectation gap (imagery or copy), not a fit defect, and didn't propose a change because CM is 44%.
- **TEE2FOR50 multi-buy** is CM-negative (−12.4%). It was introduced to make the tee decoy realistic, and the agent picked it up as a separate signal.
- **Data gaps called out:** no marketing spend or CAC, so WELCOME30 payback can't be computed; no air-freight rates; no exchange data.
