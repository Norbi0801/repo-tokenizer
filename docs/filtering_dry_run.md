# Dry-run filtracji i normalizacji

Aby przetestować reguły filtracji/normalizacji na konkretnym pliku bez modyfikowania repozytorium, skorzystaj ze skryptu `scripts/dry-run-filter.ts`.

## Wymagania wstępne
- `pnpm install`
- Środowisko Node.js 20+

## Uruchomienie
```bash
pnpm ts-node scripts/dry-run-filter.ts <ścieżka-do-pliku>
```

Skrypt wypisze:
- wynik `FileDetector` (czy plik jest binarny/duży/wygenerowany),
- statystyki normalizacji (czy usunięto BOM, znormalizowano EOL, przycięto trailing whitespace),
- listę zastosowanych reguł sanitizacji,
- potencjalne trafienia skanera sekretów,
- wynik deduplikacji (hash, informacja o duplikacie).

Dzięki temu można iteracyjnie dostrajać wzorce `.gitignore`, reguły sanitizacji czy progi wielkości plików bez uruchamiania pełnego pipeline'u.
