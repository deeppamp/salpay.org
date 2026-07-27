# SalPay application

Policy API, website, deploy pack, and wallet integration for **.sal** names.

| Path | Purpose |
|------|---------|
| `backend/` | Mint, resolve, registry, ops (Node) |
| `frontend/` | sal.cash site (Next.js) |
| `deploy/` | Docker Compose, nginx, treasury-view installers |
| `docs/` | Operator + **wallet integration** docs |
| `scripts/` | Server/ops helpers (no secrets in git) |
| `wallet-integration/` | Drop-in pack for third-party GUIs |

**Start here**

- Repo overview: [`../README.md`](../README.md)  
- **How SalPay works (users):** [`docs/HOW-IT-WORKS.md`](docs/HOW-IT-WORKS.md)  
- **Add mint/send to any wallet:** [`docs/WALLET-INTEGRATION-SIMPLE.md`](docs/WALLET-INTEGRATION-SIMPLE.md)  
- Mainnet env template: [`deploy/env.mainnet.example`](deploy/env.mainnet.example)  
- Server bootstrap: [`docs/SERVER-BOOTSTRAP.md`](docs/SERVER-BOOTSTRAP.md)

Production API: **https://sal.cash**
