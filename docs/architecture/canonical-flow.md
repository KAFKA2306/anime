# Canonical flow

The repository has one production data and UI path:

```text
d Anime Store public catalogue
  -> scripts/acquire-danime.mjs
  -> data/source + data/by-year
  -> data/works.json + attributes/by-work
  -> scripts/validate-data.mjs
  -> index.html + app.js + tag-ranking.js
  -> GitHub Pages
```

`data/manifest.json` is the canonical integrity summary. `ontology/project.yaml` defines the machine-readable acquisition/classification/publication contract. Files under `verification/` are evidence outputs only; they are not alternate data sources.

## Repository KPIs

The repository-level ratchet uses at most three outcome metrics:

1. **Search availability** — canonical works that remain discoverable in the public UI.
2. **Freshness** — age of the latest validated canonical acquisition recorded by the manifest.
3. **Verified coverage** — works whose published attributes retain explicit source/provenance evidence.

These are outcome categories, not fabricated measurements. Numeric values are reported only where existing canonical data can calculate them.

## Non-goals

- Keeping one-off diagnostic workflows as permanent production automation.
- Treating debug logs or workflow probes as canonical evidence.
- Adding another dataset or UI entrypoint when the existing canonical model can represent the requirement.
