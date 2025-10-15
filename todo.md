# Plan wdrożenia repo-tokenizer

## Faza 0 – Przygotowanie projektu
- [x] Zatwierdzić zakres funkcjonalności i priorytety wdrożenia na podstawie `features.md`.
- [x] Opracować architekturę wysokiego poziomu (pipeline ingest → chunking → storage → API) wraz z diagramem przepływu.
- [x] Ustalić stack technologiczny (język, frameworki, storage) i założyć repozytorium z bazową strukturą katalogów.
- [x] Skonfigurować automatyzację: CI z lint/test, podstawowe reguły bezpieczeństwa, szablony PR/issue.

## Faza 1 – Obsługa repozytoriów
- [x] Zaimplementować moduł odczytu repozytoriów Git (lokalnych i zdalnych) z obsługą gałęzi/commitów/tagów.
- [x] Zapewnić respektowanie `.gitignore`, `global .gitignore` i `.git/info/exclude` + możliwość dodatkowych wzorców glob/regex.
- [x] Dodać wykrywanie monorepo i ograniczanie po workspace (pnpm/yarn/go) oraz ścieżkach/pakietach.
- [x] Dodać wsparcie dla snapshotów read-only oraz pracy na archiwach (`.tar`, `.zip`) i katalogach bez Git.
- [x] Zaimplementować tryb sparse checkout/sparse index dla bardzo dużych repozytoriów.
- [x] Wprowadzić pinowanie źródła do commita/merge-base i deterministyczne snapshoty (hash + metadane).

## Faza 2 – Tokenizacja i chunking
- [x] Zaprojektować plugin interface dla tokenizerów i zaimplementować adaptery (np. tiktoken, sentencepiece).
- [x] Dostarczyć podstawowe tryby chunkingu: stały rozmiar (linie, tokeny), sliding window, „by file section”.
- [x] Wprowadzić adaptacyjny chunking (łączenie małych plików, dzielenie dużych) oraz konfigurowalne overlapy.
- [x] Zaimplementować budżet kontekstu z automatycznym doborem rozmiaru chunków względem limitu tokenów.
- [x] Wygenerować stabilne identyfikatory chunków (content hash + ścieżka) i deterministyczne sortowanie wyników.
- [x] Przygotować zestaw testów porównawczych chunkingu (różne języki, małe/duże pliki).

## Faza 3 – Normalizacja i filtracja treści
- [x] Wykrywać i pomijać pliki binarne/duże według rozmiaru, rozszerzeń i heurystyk MIME.
- [x] Auto-wykrywać pliki generowane (`dist`, `build`, `.min.js`, `vendor`) oraz noise (licencje, boilerplate).
- [x] Normalizować końcówki linii, usuwać BOM i nadmiarowe spacje według konfiguracji.
- [x] Zaimplementować deduplikację treści (hash) oraz sanitizację wg reguł (sekrety, zakazane tokeny, komentarze generowane).
- [x] Udokumentować mechanizmy filtracji i zapewnić możliwość testowania wzorców (np. tryb dry-run).

## Faza 4 – API, eksport i CLI
- [ ] Zaimplementować MCP server z narzędziami `list_files`, `get_file`, `list_chunks`, `get_chunk`, `search_text`, `search_symbols`.
- [ ] Przygotować formaty eksportu JSONL i SQLite oraz strumieniowanie wyników z kontrolą back-pressure.
- [ ] Opracować SDK/klientów referencyjnych (Node.js/Python) i wygenerować specyfikację OpenAPI.
- [ ] Dodać webhooki/kolejki (SQS/NATS) do asynchronicznej dostawy indeksów.
- [ ] Dostarczyć CLI (`init`, `index`, `serve`, `export`) z konfiguracją YAML/TOML, profilami i autouzupełnianiem powłoki.
- [ ] Udokumentować API, CLI i przykładowe przepływy integracyjne.

## Faza 5 – Inkrementalne aktualizacje i bezpieczeństwo
- [ ] Zaimplementować analizę diff (git diff vs ostatni snapshot) oraz cache tokenizacji po hashach treści.
- [ ] Dodać tryb watch (fsnotify/inotify) i harmonogramy reindeksacji (cron/CI).
- [ ] Wprowadzić maskowanie sekretów, integracje z zewnętrznymi skanerami i redakcję logów/eksportów.
- [ ] Zapewnić szyfrowanie eksportów (AES/GPG) oraz podpisy hash (SHA-256) do weryfikacji integralności.
- [ ] Zweryfikować zgodność z wymaganiami air-gap (brak telemetrii, brak zależności sieciowych w trybie offline).

## Faza 6 – Integracje, wydajność i obserwowalność
- [ ] Obsłużyć Git submodules, Git LFS oraz worktrees w pipeline'ie ingestu.
- [ ] Dostosować integracje z GitHub/GitLab (indeksowanie PR diff, komentarze, status checks).
- [ ] Przygotować hooki (pre-commit, job CI „index repo”) i raportowanie metryk do pipeline'ów.
- [ ] Zaimplementować równoległe przetwarzanie, back-pressure IO, sharding indeksu i mechanizmy resume.
- [ ] Dostarczyć metryki Prometheus/OTel, dashboardy Grafana/Datadog oraz health-checki readiness/liveness.
- [ ] Zintegrować profilery CPU/heap i trace’owanie długotrwałych zadań.

## Faza 7 – Doświadczenie deweloperów i interfejsy
- [ ] Zapewnić rozbudowane logowanie (levele), tryb dry-run i raporty jakości chunków/diff snapshotów.
- [ ] Przygotować zestawy testowych repo (JS/TS, Python, Java, Go, Rust) oraz generator sample datasetów.
- [ ] Stworzyć TUI/HTML raport (rozmiary, rozkład języków, najcięższe pliki) oraz pluginy IDE (VS Code/JetBrains).
- [ ] Opracować integrację web (self-service) i kontekstowe MCP tools (`diff_chunks`, `blame`, `resolve_ref`, `context_pack`).
- [ ] Udokumentować dobre praktyki użytkowania i przygotować tutoriale/dev guides.

## Faza 8 – Reguły domenowe, formaty i kolejne kroki
- [ ] Wdrożyć licencyjną filtrację, anonimizację PII i reguły branżowe (SOX/GDPR) jako zestawy konfiguracyjne.
- [ ] Dodać eksport Parquet, snapshoty delta i manifesty MLOps, wraz z adapterami do FAISS/Qdrant/pgvector.
- [ ] Zaprojektować i wdrożyć system rekomendacji kontekstu oraz inteligentne profile chunkingu per język.
- [ ] Zbudować mapowanie test ⇄ plik źródłowy oraz indeks symboli/graf zależności.
- [ ] Przygotować roadmapę na dalsze funkcje (embeddingi, hybrydowe wyszukiwanie, powiadomienia o jakości indeksu).
