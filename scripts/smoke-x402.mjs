const baseUrl = (process.env.AGENTLEDGER_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const address = process.env.LIVE_TEST_ADDRESS?.trim();
const facilitatorConfigured = ["OKX_API_KEY", "OKX_SECRET_KEY", "OKX_PASSPHRASE", "AGENTLEDGER_PAY_TO_ADDRESS"]
  .every((name) => Boolean(process.env[name]?.trim()));

if (!address || !facilitatorConfigured) {
  console.error("x402 smoke test not run: set LIVE_TEST_ADDRESS, AGENTLEDGER_PAY_TO_ADDRESS, OKX_API_KEY, OKX_SECRET_KEY and OKX_PASSPHRASE first.");
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
      // Keep the smoke output bounded and machine-readable enough for a terminal.
    }
    return { response, payload };
  };

  const decodeChallenge = (value) => {
    try {
      return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
    } catch {
      return null;
    }
  };

  const checkChallenge = (label, result, expectedNetwork) => {
    const requestId = result.response.headers.get("x-request-id") || "missing";
    const header = result.response.headers.get("PAYMENT-REQUIRED");
    const challenge = header ? decodeChallenge(header) : null;
    const passed = result.response.status === 402 &&
      Boolean(challenge?.x402Version === 2) &&
      Array.isArray(challenge?.accepts) &&
      challenge.accepts.length > 0 &&
      challenge.accepts.every((option) => option.network === expectedNetwork);
    console.log(`${passed ? "PASS" : "FAIL"} ${label}: HTTP ${result.response.status}; requestId=${requestId}; x402Version=${challenge?.x402Version ?? "unknown"}; options=${challenge?.accepts?.length ?? 0}`);
    return passed;
  };

  try {
    const freeHealth = await requestJson("POST", "/api/company-health", { address, days: 30 });
    const recommendations = await requestJson("POST", "/api/recommendations", { address, days: 30, monthlyBudget: 500 });
    const policyGuard = await requestJson("POST", "/api/evaluate-action", {
      entity: address,
      action: { type: "service_purchase", amount: 25, provider: "0x0000000000000000000000000000000000000001" },
      context: { days: 30 },
      policy: { monthlySpendLimit: 500 },
    });

    const freeRequestId = freeHealth.response.headers.get("x-request-id") || "missing";
    const freePassed = freeHealth.response.status !== 402;
    console.log(`${freePassed ? "PASS" : "FAIL"} company-health remains free: HTTP ${freeHealth.response.status}; requestId=${freeRequestId}; dataSource=${freeHealth.payload?.dataSource ?? "n/a"}`);
    const passed = [
      freePassed,
      checkChallenge("recommendations payment challenge", recommendations, "eip155:196"),
      checkChallenge("policy guard payment challenge", policyGuard, "eip155:196"),
    ].every(Boolean);

    if (!passed) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`x402 smoke test failed: ${error instanceof Error ? error.message : "request error"}`);
    process.exitCode = 1;
  }
}
