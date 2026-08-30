const baseUrl = (process.env.AGENTLEDGER_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const address = process.env.LIVE_TEST_ADDRESS?.trim();
const monthlyBudget = Number(process.env.LIVE_TEST_MONTHLY_BUDGET || "500");

if (!address) {
  console.error("Live smoke test not run: set LIVE_TEST_ADDRESS and configure OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE and AGENTLEDGER_PAY_TO_ADDRESS first.");
  process.exitCode = 1;
} else if (!Number.isFinite(monthlyBudget) || monthlyBudget < 0) {
  console.error("Live smoke test not run: LIVE_TEST_MONTHLY_BUDGET must be a non-negative number.");
  process.exitCode = 1;
} else {
  const requestJson = async (method, path, body) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // Keep the smoke output useful even when an upstream proxy returns non-JSON.
    }
    return { response, payload };
  };

  const printResult = (label, result, highLevel) => {
    const requestId = result.response.headers.get("x-request-id") || "missing";
    const source = result.payload?.dataSource || "n/a";
    const paidChallenge = result.response.status === 402 && result.response.headers.has("PAYMENT-REQUIRED");
    const passed = label === "recommendations"
      ? paidChallenge
      : result.response.ok && (label === "health" || source === "okx");
    console.log(`${passed ? "PASS" : "FAIL"} ${label}: HTTP ${result.response.status}; requestId=${requestId}; dataSource=${source}; ${highLevel(result.payload)}`);
    return passed;
  };

  try {
    const health = await requestJson("GET", "/api/health");
    const companyHealth = await requestJson("POST", "/api/company-health", { address, days: 30, monthlyBudget });
    const recommendations = await requestJson("POST", "/api/recommendations", { address, days: 30, monthlyBudget });

    const passed = [
      printResult("health", health, (payload) => `status=${payload?.status || "unknown"}`),
      printResult("company-health", companyHealth, (payload) => `spend=${payload?.cashFlow?.spend ?? "unknown"}; insights=${payload?.insights?.length ?? 0}`),
      printResult("recommendations", recommendations, (payload) => `paymentChallenge=${recommendations.response.headers.has("PAYMENT-REQUIRED")}; status=${payload?.financialStatus || "paid-route"}`),
    ].every(Boolean);

    if (!passed) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Live smoke test failed: ${error instanceof Error ? error.message : "request error"}`);
    process.exitCode = 1;
  }
}
