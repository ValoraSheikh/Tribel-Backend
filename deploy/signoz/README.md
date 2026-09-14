# SigNoz (self-hosted) — ops runbook

Config lives here: `casting.yaml`. Generated output: `pours/` (gitignored — never edit by hand, `forge` overwrites it).

## Install / apply

```bash
curl -fsSL https://signoz.io/foundry.sh | bash   # once per machine: installs foundryctl
cd deploy/signoz
foundryctl gauge -f casting.yaml                 # validates the box (docker, compose, memory)
foundryctl forge -f casting.yaml                 # renders pours/ — nothing starts
foundryctl cast  -f casting.yaml                 # starts the stack
```

## Day-to-day

```bash
docker compose -f pours/deployment/compose.yaml ps
docker compose -f pours/deployment/compose.yaml logs -f <service>
docker compose -f pours/deployment/compose.yaml restart <service>
```

## Upgrade SigNoz

1. Bump the `signoz` / `ingester` image tags in `casting.yaml`.
2. `foundryctl cast -f casting.yaml` (SigNoz runs its own schema migrations on startup).

## Access / retention

- UI on the box: `http://127.0.0.1:8080` — public front: `https://signoz.tribel.in` (nginx).
- OTLP ingest on the box: `http://127.0.0.1:4318` — public front: `https://otel.tribel.in` (nginx).
- Retention: SigNoz UI → Settings → General → traces 7d, logs 7d, metrics 15d (20GB disk).
