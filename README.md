# AgentLedger

**The financial control plane for autonomous agents.**

> Financial execution requires financial governance.

AgentLedger converts financial state and policy into machine-readable recommendations and capital decisions for autonomous agents. It is an API-only, deterministic, explainable service that sits between agent intent and capital movement.

```text
Calling agent
    ↓
financial state + proposed action + policy
    ↓
AgentLedger
    ↓
normalize → analyze → evaluate policy
    ↓
recommendation / APPROVE / CAUTION / REJECT
```

Autonomous agents can already spend, trade and purchase services. AgentLedger supplies the financial decision layer that helps them understand operating health and govern spending before money moves.

AgentLedger is not a wallet, accounting system, tax system, investment adviser, portfolio manager, trading bot or execution engine. It never signs or executes capital movement.

## Core services

### Financial Health — FREE

**How am I?**

`POST /api/company-health` analyzes cash flow, spending, budget utilization, spend velocity, provider concentration, failed transactions and repeated providers. Caller-provided financial state is the preferred input; the built-in OKX wallet adapter is an optional convenience.

### Recommendations — $0.01 USDT/call

**What should I do next?**

`POST /api/recommendations` turns financial state and optional policy into at most three prioritized financial actions. The hosted route uses x402 on X Layer and returns an HTTP 402 payment challenge before paid processing.

### Policy Guard — $0.02 USDT/call

**Should this capital move?**

`POST /api/evaluate-action` evaluates `service_purchase` and `capital_allocation` actions against caller-supplied financial state and policy. It returns an explainable `approve`, `caution` or `reject` decision. The hosted route uses x402 on X Layer.

Compatibility primitives remain available and free:

```text
POST /api/can-i-spend
POST /api/can-i-allocate
```

They are not initial Marketplace services.

## Agent-native architecture

AgentLedger does not need control of an agent's wallet. A calling agent can use Agentic Wallet, exchange APIs, wallet tools, accounting tools, execution systems or internal strategy state to gather factual financial state and send it to AgentLedger.

```text
Calling Agent
    ↓
Agentic Wallet / execution tools / financial tools
    ↓
financial state + proposed action + policy
    ↓
AgentLedger
    ↓
normalize → financial analysis → policy evaluation
    ↓
recommendation / APPROVE / CAUTION / REJECT
```

Data acquisition and financial reasoning are separate layers. With `source: "provided_state"`, the caller supplies the facts and AgentLedger derives the conclusions; AgentLedger does not independently attest to the values. With `source: "okx"`, the optional server-side OKX adapter fetches and normalizes wallet history. With demo routes, the data is deterministic fixture data.

## Quick Start

```bash
npm install
cp .env.example .env.local
npm run dev
```

The API runs at `http://localhost:3000`. No UI, database, authentication layer or external service is required for explicit demo routes.

## Demo mode

Use the explicit free demo routes for onboarding and local integration tests. They always identify their source as `dataSource: "demo"` and never invoke x402:

```text
POST /api/demo/company-health
POST /api/demo/recommendations
POST /api/demo/evaluate-action
POST /api/demo/can-i-spend
POST /api/demo/can-i-allocate
```

Example:

```bash
curl -X POST http://localhost:3000/api/demo/company-health \
  -H "Content-Type: application/json" \
  -d '{
    "address": "0xagentcompany",
    "days": 30,
    "monthlyBudget": 500
  }'
```

The seeded company has marketplace, research-service and client inflows, repeated payments to agent vendors, stablecoin activity across USDT/USDC/USDG, spend acceleration and one failed transaction.

## API examples

### Financial Health from caller-provided state

```bash
curl -X POST http://localhost:3000/api/company-health \
  -H "Content-Type: application/json" \
  -d '{
    "source": "provided_state",
    "financialState": {
      "periodDays": 30,
      "cashFlow": { "inflows": 342, "outflows": 235 },
      "spendVelocity": { "firstHalf": 65, "secondHalf": 170 },
      "providers": [
        { "provider": "research-agent", "spend": 128, "transactions": 6 },
        { "provider": "data-agent", "spend": 42, "transactions": 3 }
      ],
      "failedTransactions": 1
    },
    "monthlyBudget": 500
  }'
```

This free production path does not require OKX Open API credentials.

### Recommendations

```bash
curl -i -X POST https://agentledger-one.vercel.app/api/recommendations \
  -H "Content-Type: application/json" \
  -d '{
    "source": "provided_state",
    "financialState": {
      "periodDays": 30,
      "cashFlow": { "inflows": 342, "outflows": 235 },
      "spendVelocity": { "firstHalf": 65, "secondHalf": 170 },
      "providers": [
        { "provider": "research-agent", "spend": 128, "transactions": 6 }
      ],
      "failedTransactions": 1
    },
    "monthlyBudget": 500,
    "policy": { "reservePct": 20, "maxProviderConcentrationPct": 35 }
  }'
```

The hosted route is paid. An unpaid valid request returns the SDK-generated x402-v2 HTTP 402 challenge; a buyer then supplies a valid payment and replays the request.

### Policy Guard service purchase

```bash
curl -i -X POST https://agentledger-one.vercel.app/api/evaluate-action \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "agent-123",
    "action": {
      "type": "service_purchase",
      "amount": 25,
      "provider": "research-agent"
    },
    "financialState": {
      "periodDays": 30,
      "cashFlow": { "inflows": 342, "outflows": 235 },
      "providers": [
        { "provider": "research-agent", "spend": 128, "transactions": 6 }
      ]
    },
    "policy": {
      "monthlySpendLimit": 500,
      "reservePct": 20,
      "maxProviderConcentrationPct": 35,
      "maxSingleActionAmount": 100
    }
  }'
```

Policy Guard is execution-independent: the caller decides what to do with the result.

### Capital allocation

```bash
curl -i -X POST https://agentledger-one.vercel.app/api/evaluate-action \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "trading-agent",
    "action": {
      "type": "capital_allocation",
      "amount": 250,
      "strategy": "momentum-v2"
    },
    "state": {
      "currentStrategyAllocation": 1200,
      "totalCapital": 5000,
      "dailyLossUsed": 76
    },
    "policy": {
      "maxStrategyAllocationAbsolute": 1500,
      "maxStrategyAllocationPct": 35,
      "dailyLossLimit": 100,
      "cautionLossUtilizationPct": 70,
      "criticalLossUtilizationPct": 90
    }
  }'
```

Trading agents decide what to trade. AgentLedger decides how much capital they are financially allowed to risk.

The complete machine-readable contract is available at [`/openapi.json`](https://agentledger-one.vercel.app/openapi.json).

## Hosted vs self-hosted

AgentLedger is open source and can be self-hosted. The hosted AgentLedger ASP provides a maintained, production-ready machine-to-machine service with x402 payment and OKX.AI discovery for agents that prefer direct access over operating their own deployment.

## Payment model

AgentLedger uses x402 v2 on X Layer mainnet:

```text
CAIP-2 network: eip155:196
Settlement asset: USDT
Recommendations: 0.01 USDT/call
Policy Guard: 0.02 USDT/call
```

The receiving wallet is configured server-side through `AGENTLEDGER_PAY_TO_ADDRESS`. It is a public X Layer-compatible EVM address; no private key is required by the application. Payment-layer credentials are separate from optional wallet-data adapter credentials.

## Optional OKX wallet adapter

The address-based compatibility mode uses the server-only OKX transaction-history adapter. Its credentials are optional for the core provided-state engine and are required only when using wallet-history ingestion (and the current OKX facilitator configuration for paid hosted routes).

```env
OKX_API_KEY=
OKX_SECRET_KEY=
OKX_PASSPHRASE=
OKX_PROJECT_ID=
OKX_CHAINS=1
OKX_TIMEOUT_MS=8000
```

Never use `NEXT_PUBLIC_` for server credentials. Never provide a private key or seed phrase. See `.env.example` for the complete configuration and manual smoke-test variables.

## Financial policy

Policy is stateless and supplied by the caller on each decision request. AgentLedger does not persist policy profiles in this MVP.

```json
{
  "monthlySpendLimit": 500,
  "reservePct": 20,
  "maxProviderConcentrationPct": 35,
  "maxSingleActionAmount": 100,
  "maxStrategyAllocationPct": 30,
  "dailyLossLimit": 100
}
```

Default percentage thresholds are deterministic: reserve 20%, budget caution 75%, budget critical 90%, provider concentration 35%, strategy allocation 35%, loss caution 70% and loss critical 90%. Monthly spend and daily loss limits are never invented when omitted.

## Observability and validation

API responses include an `x-request-id`; valid incoming IDs are preserved. The server emits one structured JSON event per request without full request bodies, credentials, signatures, payment payloads or wallet addresses.

Run the local checks:

```bash
npm test
npm run typecheck
npm run build
npm audit --omit=dev
```

Optional manual wallet-adapter smoke test:

```bash
AGENTLEDGER_BASE_URL=http://localhost:3000 \
LIVE_TEST_ADDRESS=0xYOUR_WALLET \
LIVE_TEST_MONTHLY_BUDGET=500 \
npm run smoke:live
```

Optional x402 challenge smoke test:

```bash
npm run smoke:x402
```

No real buyer payment is performed by the automated test suite.

## Deploying to Vercel

The service is stateless and Vercel-compatible. It has no filesystem persistence assumptions.

```bash
npm install
npm run typecheck
npm test
npm run build
npx vercel login
npx vercel --prod
```

Configure paid-route variables as server-side Vercel Production environment variables. The OKX wallet adapter variables are optional unless address-based ingestion is needed:

```text
AGENTLEDGER_PAY_TO_ADDRESS
AGENTLEDGER_RECOMMENDATIONS_PRICE_USD
AGENTLEDGER_POLICY_GUARD_PRICE_USD
OKX_API_KEY
OKX_SECRET_KEY
OKX_PASSPHRASE
OKX_TIMEOUT_MS
```

`OKX_PROJECT_ID` and `OKX_CHAINS` are optional adapter settings. Configure platform or API-gateway rate limiting; no fake in-memory serverless limiter is included.

## OKX.AI Marketplace

The hosted deployment is [https://agentledger-one.vercel.app](https://agentledger-one.vercel.app), with its OpenAPI contract at [https://agentledger-one.vercel.app/openapi.json](https://agentledger-one.vercel.app/openapi.json).

AgentLedger is registered as one ASP, `AgentLedger #11336`, with three A2MCP services:

1. **AgentLedger Financial Health** — `POST /api/company-health` — free.
2. **AgentLedger Recommendations** — `POST /api/recommendations` — 0.01 USDT/call through x402.
3. **AgentLedger Policy Guard** — `POST /api/evaluate-action` — 0.02 USDT/call through x402.

Current status: **Submitted for OKX.AI Marketplace review**. It is not described here as approved or live; update this status after OKX.AI review. The [Marketplace identity page](https://www.okx.ai/agents/11336) is the public reference for the ASP.

Do not register `/api/demo/*`, `/api/can-i-spend` or `/api/can-i-allocate` as Marketplace services.

The current official flow supports multiple services under one ASP. Free A2MCP endpoints return results directly; paid A2MCP endpoints must return an x402 payment challenge and settle through the OKX Payment SDK. Review results are sent to the Agentic Wallet registration email and agent conversation. See the [OKX.AI ASP tutorial](https://www.okx.ai/tutorial/asp) and [official ASP registration guide](https://web3.okx.com/onchainos/dev-docs/okxai/registerasp).

## Future roadmap

Documentation-only future possibilities include persistent policy profiles, additional automatic state adapters, caller-state attestation and closed-loop enforcement connected to wallet or execution controls. They are intentionally not implemented in this MVP.

## License

MIT. See [LICENSE](LICENSE).
