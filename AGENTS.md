# Shopify Theme Guardrails

## Golden rules
- NEVER change section schema setting `id`s once they exist.
- NEVER rename locale keys. Only edit locale VALUES.
- When editing Liquid, keep existing blocks/sections structure unless explicitly requested.
- Return changes as a minimal diff. Prefer editing 1-3 files max.

## Before editing
- First list the exact files you will change.
- If a schema change could break Theme Editor settings, stop and ask 1 question.

## Formatting
- Keep JSON valid.
- Do not introduce trailing commas in JSON.