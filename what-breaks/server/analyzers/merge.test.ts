import test from "node:test";
import assert from "node:assert/strict";
import type { Analysis, Scored } from "../../shared/types.ts";
import { merge } from "./merge.ts";
import { selectRiskyPredictions } from "./score.ts";

test("merge de-duplicates predictions by flow and tracks foundBy", () => {
  const carbon: Analysis = {
    model: "carbon",
    flows: [
      {
        id: "checkout-submit",
        name: "Checkout Submit",
        kind: "flow",
        touches: ["src/checkout.ts"],
      },
    ],
    predictions: [
      {
        id: "carbon_1",
        flowId: "checkout-submit",
        risk: "medium",
        hypothesis: "Null pointer when coupon is empty",
        cites: [{ file: "src/checkout.ts", lines: "10-15" }],
        howToVerify: "Submit checkout with empty coupon",
        foundBy: ["carbon"],
      },
    ],
  };

  const argon: Analysis = {
    model: "argon",
    flows: [
      {
        id: "checkout_submit",
        name: "Checkout Submit",
        kind: "flow",
        touches: ["src/api/order.ts"],
      },
      {
        id: "login",
        name: "Login",
        kind: "page",
        touches: ["src/login.ts"],
      },
    ],
    predictions: [
      {
        id: "argon_1",
        flowId: "checkout_submit",
        risk: "high",
        hypothesis: "Order POST crashes on undefined discount",
        cites: [{ file: "src/api/order.ts", lines: "40" }],
        howToVerify: "Submit order without discount",
        foundBy: ["argon"],
      },
      {
        id: "argon_2",
        flowId: "login",
        risk: "low",
        hypothesis: "Redirect query param dropped",
        cites: [{ file: "src/login.ts" }],
        howToVerify: "Login with ?next=/cart",
        foundBy: ["argon"],
      },
    ],
  };

  const merged = merge([carbon, argon]);
  assert.equal(merged.flows.length, 2);
  assert.equal(merged.predictions.length, 2);

  const checkoutPred = merged.predictions.find((p) => p.flowId === "checkout-submit");
  assert.ok(checkoutPred);
  assert.deepEqual(checkoutPred.foundBy.sort(), ["argon", "carbon"]);
  assert.equal(checkoutPred.risk, "high");
  assert.equal(checkoutPred.cites.length, 2);
});

test("selectRiskyPredictions enforces max cap of 10 sorted by pBreak", () => {
  const items: Scored[] = Array.from({ length: 14 }, (_, i) => ({
    id: `p_${i + 1}`,
    flowId: `flow-${i + 1}`,
    risk: "high",
    hypothesis: `Break ${i + 1}`,
    cites: [{ file: "src/app.ts" }],
    howToVerify: "Open page",
    foundBy: ["carbon"],
    pBreak: Number((0.46 + i * 0.03).toFixed(2)),
    risky: i >= 2, // 12 risky items
  }));

  const { toVerify, notFlagged } = selectRiskyPredictions(items, 10);
  assert.equal(toVerify.length, 10);
  assert.equal(notFlagged.length, 4);
  assert.ok(toVerify[0].pBreak >= toVerify[9].pBreak);
});
