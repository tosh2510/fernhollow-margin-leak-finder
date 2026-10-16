# Decisions log

Judgment calls made while building, in order.

1. **Brand name.** A web search for "Fernhollow" apparel turned up no brand of that name (only unrelated fern+daisy, Fernweh, FernMark), so the name was kept.
2. **Scale inconsistency in the brief.** 15k orders × a $110–160 AOV comes to ~$1.6–2.4M, not $3.5–4.5M, and 4k customers × 3.75 orders/yr is unrealistic for DTC apparel. AOV, units per order and revenue were kept as targets and counts were scaled: about 24.5k orders and 13.8k customers (9k new in the window + 4.8k pre-window actives), ~1.8 orders per customer per year. Phase 1 asserts orders in [24k, 34k] and customers in [11k, 16k].
3. **Customers table added** (`shopify_customers`). It isn't in the brief, but cohort analysis needs first-touch channel and created_at. Pre-window customers are kept so the cohort comparison doesn't treat every buyer as new.
4. **`amount` added to `shopify_refunds`.** Shopify refunds carry amounts; without one, refunds would have to be inferred.
5. **Subtotal = after discounts** (Shopify `subtotal_price`), and the free-shipping threshold is tested against it.
6. **Shipping charged treated as recovery.** The waterfall line "Outbound shipping" is shown net of the $7.95 charged below the threshold, which keeps the brief's 11 steps.
7. **Gross margin definition:** (sales after discounts − landed COGS of shipped units) / sales after discounts. It lands at ~64.7%.
8. **Duty rates** are blended effective rates in the brief's 16–28% band. The real 2025–26 tariff regime varies by origin and HTS code and should come from the broker. This is flagged in the assumptions table.
9. **Tee economics.** Under revenue-share allocation a tee with a normal ~55% GM can't be CM-negative, because it absorbs very little order cost. The decoy was made realistic with two levers, not a fake cost:
   - a low-margin traffic SKU (FOB $15.95 Portugal heavyweight organic, ~32% GM at list);
   - an evergreen "2 for $50" multi-buy, which puts a tee pair exactly on the $50 free-shipping threshold.

   That ties leaks 2 and 5 together, as they would be in real life.
10. **Wrap dress negativity is at the M/L level, not the whole style.** A $148 dress at ~68% GM with ~47% blended returns isn't CM-negative under realistic costs, so the plant makes M/L negative (61–64% returns, a 58% restock rate on tried-on jersey) and leaves XS/S/XL healthy. This also makes "don't discontinue the style" a decision the data can show, not one it simply asserts.
11. **Attach-rate definition.** The tee's attach rate is reported on *mixed* multi-item baskets (≥2 units including a non-tee item), at 47%. Counting tee-only pairs as "multi-item" inflates it to 58%, which would be misleading.
12. **Incremental vs allocated CM.** Allocation (revenue or units) is used only to *attribute* CM to slices. Scenarios remove lines incrementally: base order costs stay unless the order disappears. Company totals are allocation-invariant, and a unit test asserts this.
13. **Threshold conversion trade-off.** Abandon rate 12% (low confidence), trade-up not counted. Both are shown as assumptions, with a 25%/40% stress test in the trace.
14. **Inventory.** Velocity is the trailing 13-week average, and overstock is judged at *peak* velocity (best 8 weeks) so seasonal knitwear isn't misflagged in September. Safety stock is z=1.65 × σ_weekly × √LT. MOQ applies per style-colour.
15. **Stockout lost units** are estimated from the 28 in-stock days before each outage × (1 − 25% substitution). The estimate ran 6.9% high against ground truth; that's noted in run-notes.
16. **Recorded run, real timestamps.** Trace timestamps are when the CLI actually ran on 16 Oct 2026. The UI replays the recording and does not re-run an LLM.
17. **Mid-run tool change.** `--where` was added to `describe_table` at step 56 for PO lines; it's logged in the trace and in run-notes.
18. **The `planted.json` text was corrected after the run** (float formatting, a stale AOV). The data files were verified byte-identical with shasum before and after.
19. **No marketing spend in the mirror.** CM is "contribution after fulfilment, before marketing". WELCOME30 economics are judged without CAC, and that's stated as a limitation.
20. **Proposal arithmetic.** PO extended values and markdown prices are left out of the proposal JSON and computed by code in the UI, so no hand-typed arithmetic appears.
