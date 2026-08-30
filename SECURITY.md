# Security

## Reporting a vulnerability

Please report suspected vulnerabilities privately to the repository maintainers before opening a public issue. Include the affected endpoint or file, reproduction steps, impact and a suggested mitigation when available. Do not include credentials, private keys or other sensitive material in the report.

## Credential handling

- Keep populated `.env` and `.env.local` files out of Git; only commit `.env.example` with empty placeholders.
- Store OKX facilitator and optional wallet-adapter credentials in server-side deployment environment variables.
- Never use `NEXT_PUBLIC_` for secrets.
- AgentLedger does not require or handle private keys, seed phrases or wallet signing material.
- `AGENTLEDGER_PAY_TO_ADDRESS` is a public receiving address only.
- Payment payloads, signatures, credentials and full request bodies must not be logged.

## Scope

AgentLedger is a financial operations intelligence and policy-control API. It does not execute trades, move funds or provide investment, tax or accounting advice.
