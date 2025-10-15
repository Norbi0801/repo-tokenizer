# Faza 0 – Przygotowanie projektu

## Zakres i priorytety
Poniższe priorytety wynikają z aktualnej listy funkcjonalności w `features.md`. Podzielono je na trzy poziomy, aby uporządkować realizację roadmapy.

### Priorytet P0 – uruchomienie MVP indeksowania
- Obsługa repozytoriów Git (lokalne/zdalne), snapshoty read-only, respektowanie `.gitignore`.
- Podstawowe tryby chunkingu (linie, tokeny, sliding window) i stabilne identyfikatory chunków.
- Filtracja binariów i plików generowanych, deduplikacja treści.
- Eksport JSONL i MCP API `list_files`, `list_chunks`, `get_chunk`, `search_text`.
- Konfiguracja CLI (`init`, `index`, `serve`) z plikiem konfiguracyjnym.
- Maskowanie sekretów i tryb air-gapped.

### Priorytet P1 – wzmocnienie DX i wydajności
- Adaptacyjny chunking, budżet kontekstu, cache tokenizacji i watch mode.
- Integracje VCS/CI (PR diff, hooki), wsparcie monorepo i archiwów.
- Tryby incremental diff, webhooki/kolejki eksportowe, SDK (Node.js/Python).
- Logowanie wielopoziomowe, dry-run, zestawy testowych repo.
- Rozszerzona filtracja (normalizacja EOL, sanitizacja, redakcja logów).

### Priorytet P2 – zaawansowane funkcje analityczne
- Integracje z wektorówkami, hybrydowe wyszukiwanie, embeddingi.
- Indeks symboli, graf zależności, mapowanie testów do kodu.
- TUI/HTML raporty, pluginy IDE/przeglądarka, rekomendacje kontekstu.
- Reguły domenowe (licencje, PII, branżowe), eksport Parquet/Snapshoty delta.
- Obserwowalność produkcyjna (Prometheus/OTel, dashboardy, alerty).

Uzgodnienie: zakres P0 i P1 traktujemy jako „core launch”, P2 jako dalszą rozbudowę po uzyskaniu feedbacku użytkowników.

## Architektura wysokiego poziomu
Pipeline dzieli się na cztery główne warstwy. Poniższy schemat pokazuje przepływ danych i odpowiedzialności.

```
┌──────────┐   fetch   ┌─────────────┐  normalize  ┌────────────┐  index/store  ┌───────────────┐
│ Ingestor │ ───────→ │ Repo Cache  │ ──────────→ │ Chunker    │ ─────────────→ │ Storage Layer │
└──────────┘           │ (snapshot)  │             │ + Filters  │               │ (JSONL/DB)    │
      │                └─────────────┘             └────────────┘               └──────┬────────┘
      │                                                                                 │
      │   diff/watch                                                                     │ serve/export
      │                                                                                 ▼
      └───────────────────────────────→ Orchestrator/Queue ─────────────────────→ API (MCP/CLI)
```

### Warstwy i odpowiedzialności
- **Ingestor** – klonuje/pobiera repozytorium, zarządza trybem sparse i archiwami, wylicza diffy względem cache.
- **Repo Cache** – przechowuje snapshoty repo (content-addressed) i metadane (commit, hash, ścieżki).
- **Chunker + Filters** – wykonuje tokenizację, chunking, normalizację, deduplikację oraz sanitizację.
- **Storage Layer** – przechowuje wynikowe chunku w formacie JSONL, SQLite lub adaptorach wektorowych; utrzymuje indeks metadanych.
- **Orchestrator/Queue** – zarządza zadaniami (full index, incremental diff, watch) i rozdziela je na workerów.
- **API (MCP/CLI)** – udostępnia narzędzia MCP, eksporty, streaming oraz integracje webhook/kolejki.

### Przepływ danych
1. Scheduler lub CLI uruchamia zadanie indeksacji (full/diff/watch).
2. Ingestor aktualizuje repo cache i dostarcza listę zmienionych plików.
3. Chunker przetwarza pliki według konfiguracji (tokenizer, strategie, overlapy).
4. Filtry wykonują sanitizację, deduplikację i generują stabilne identyfikatory.
5. Storage zapisuje wynik w docelowym formacie i publikuje event o dostępności indeksu.
6. API/CLI obsługuje zapytania (list/search) i eksporty, korzystając z tych samych metadanych.

## Stack technologiczny i struktura repozytorium
### Stack wykonawczy
- **Język główny:** TypeScript (Node.js 20 LTS) – szybkie iteracje, bogaty ekosystem (CLI, MCP, integracje).
- **Warstwa wydajnościowa:** Rust (komponent opcjonalny) z N-API, używany do ciężkiej tokenizacji i I/O równoległego.
- **Baza danych/metadane:** SQLite dla trybu embedded, JSONL/Parquet dla eksportów; adaptery do FAISS/Qdrant/pgvector.
- **Kolejki/komunikacja:** BullMQ (Redis) dla trybu wielowątkowego; alternatywnie NATS w środowiskach rozproszonych.
- **Konfiguracja:** pliki YAML/TOML, ładowane przez `@iarna/toml` oraz `js-yaml`.
- **Testy:** Vitest (unit), Jest snapshots dla chunków, Playwright dla E2E CLI/API.

### Struktura katalogów (utworzona)
```
repo-tokenizer/
├─ src/
│  ├─ ingest/
│  ├─ chunker/
│  ├─ storage/
│  ├─ api/
│  ├─ cli/
│  └─ common/
├─ tests/
│  ├─ unit/
│  └─ integration/
├─ config/          # przykładowe konfiguracje (yaml/toml)
├─ scripts/         # narzędzia deweloperskie, migracje, bootstrap
├─ docs/            # dokumentacja (np. phase0_plan.md)
├─ examples/        # sample repo + konfiguracje demonstracyjne
├─ data/            # cache testowe, logi lokalne (ignored w git)
└─ features.md
```

W kolejnych fazach dodamy pliki `package.json`, konfiguracje TypeScript, pipeline CI itp. (po ukończeniu Fazy 0).

## Automatyzacja (CI, bezpieczeństwo, szablony)
- **CI GitHub Actions** (`.github/workflows/ci.yml`): lint (`npm lint`), testy jednostkowe i integracyjne, job bezpieczeństwa (gitleaks, `npm audit`, `cargo audit`).
- **Polityki bezpieczeństwa** (`config/policies/gitleaks.toml`): centralne wzorce blokujące wycieki, możliwość rozszerzania o baseline.
- **Szablony PR/issue**: `pull_request_template.md` z checklistą, `ISSUE_TEMPLATE/bug_report.md` i `feature_request.md`.
- **Przygotowanie pod dalszą automatyzację**: katalog `scripts/` na narzędzia developerskie, `config/` na konfiguracje lint/tokenizacji; plan dodania pre-commit w Fazie 5.
