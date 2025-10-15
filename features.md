# Features

## Obsługa repozytoriów
- Git (lokalne i zdalne) z pełnym wsparciem dla gałęzi, commitów i tagów oraz pracy na snapshotach read-only.
- Respektowanie `.gitignore`, wsparcie dla własnych wzorców wykluczeń (glob/regex) i obsługa lokalnych wyjątków (`.git/info/exclude`).
- Monorepo: ograniczanie po ścieżkach i pakietach, automatyczne wykrywanie korzeni workspace (pnpm/yarn/go workspaces itp.).
- Możliwość pracy na zarchiwizowanych repozytoriach (`.tar`, `.zip`) oraz katalogach bez systemu kontroli wersji (fallback read-only).
- Tryb sparse checkout/sparse index zmniejszający IO na bardzo dużych repozytoriach.
- Pinowanie do konkretnego commita/merge-base i deterministyczne snapshoty.

## Tokenizacja i chunking
- Parsery ogólne: dzielenie po liniach, blokach, nagłówkach i komentarzach.
- Tryby chunkingu: stały rozmiar (tokens/znaki), sliding window oraz „by file section”.
- Wsparcie wielu tokenizerów (np. tiktoken, sentencepiece) poprzez plugin interface.
- Budżet kontekstu: auto-dobór chunk size pod zadany maksymalny limit tokenów.
- Adaptacyjny chunking: łączenie małych plików i dzielenie dużych według heurystyk językowych.
- Konfigurowalne overlapy, stabilne ID chunków (content hash + ścieżka) i możliwość wymuszenia deterministycznego sortowania.

## Normalizacja i filtracja treści
- Pomijanie plików binarnych i bardzo dużych (progi rozmiaru, rozszerzenia).
- Auto-wykrywanie plików generowanych (`dist`, `build`, `.min.js`, `vendor`).
- Deduplikacja treści (hash) oraz stabilne ID chunków dla referencji zwrotnych.
- Normalizacja końcówek linii i usuwanie nadmiarowych spacji oraz BOM.
- Filtrowanie komentarzy generowanych i wzorców noise (np. boilerplate licencyjny).
- Konfigurowalne reguły sanitizacji (np. wycinanie fragmentów z zakazanymi tokenami).

## Wyjścia i API (MCP)
- MCP server z narzędziami: `list_files`, `get_file`, `list_chunks`, `get_chunk`, `search_text`, `search_symbols`.
- Format eksportu: JSONL (chunks + metadane), opcjonalnie SQLite oraz Parquet.
- Strumieniowanie wyników (chunking streaming) i wsparcie dla back-pressure.
- SDK/klienci referencyjni dla Node.js/Pythona oraz specyfikacja OpenAPI do integracji HTTP.
- Webhooki i kolejki (SQS/NATS) do asynchronicznej dostawy indeksów.

## Inkrementalne aktualizacje
- Przetwarzanie tylko zmian (diff względem poprzedniego snapshotu).
- Cache tokenizacji na poziomie pliku/chunku (content hash).
- Tryb watch reagujący na zmiany w filesystemie (fsnotify/inotify).
- Harmonogramy reindeksacji (cron/CI) i odświeżanie przy merge do gałęzi głównej.

## Konfigurowalność i CLI
- Komendy `repo-tokenizer-mcp init`, `index`, `serve`, `export`.
- Plik konfiguracyjny (YAML/TOML): include/exclude, tokenizer, maksymalna liczba tokenów, strategie chunkingu.
- Profile konfiguracyjne per środowisko (np. lokalne vs CI) i override flagami CLI.
- Tryb `--dry-run`, logowanie verbose, wyjście w formacie tabelarycznym/JSON.
- Autouzupełnianie powłoki (bash/zsh/fish) i generatory dokumentacji CLI.

## Bezpieczeństwo i prywatność
- Maskowanie sekretów (detektory `.env`, kluczy, tokenów).
- Tryb air-gapped (bez sieci), brak telemetrii domyślnie.
- Redakcja w logach i eksportach (hashowanie lub placeholdery dla wrażliwych fragmentów).
- Integracja z zewnętrznymi skanerami sekretów (np. TruffleHog, GitGuardian) jako opcjonalny krok walidacyjny.
- Szyfrowanie eksportów w locie (AES/GPG) oraz podpisy hash (SHA-256) dla weryfikacji integralności.

## Integracje VCS i CI
- Git submodules, Git LFS, worktrees.
- Integracje z GitHub/GitLab: indeksowanie diffów PR, komentarze z podsumowaniem kontekstu, status checks.
- Hooki: pre-commit (walidacja sekretów), job CI „index repo”.
- Pull-based API dla platformy CI (REST/gRPC) i raportowanie metryk do pipeline'u.

## Optymalizacja i skalowanie
- Równoległe przetwarzanie, ograniczenie RAM, back-pressure na IO.
- Profile wydajności, benchmarki na dużych monorepo.
- Pamięć podręczna między branchami (content-addressed store).
- Sharding indeksu oraz możliwość działania w klastrze (worker pool, kolejki).
- Mechanizmy autoretry i resume po przerwaniu procesu.

## Jakość i DX
- Obszerne logowanie (levele), tryb suchego uruchomienia (dry-run).
- Deterministyczne buildy indeksu, snapshoty z metadanymi (commit, timestamp).
- Zestawy testowe/fixture’y dla popularnych ekosystemów (JS/TS, Python, Java, Go, Rust).
- Generator sample datasetów do manualnej inspekcji chunków.
- Porównywanie snapshotów (diff indeksów) oraz raporty regresji jakości chunków.

## Interfejsy
- MCP tools: `diff_chunks`, `blame`, `resolve_ref`, `context_pack`.
- `context_pack(files|symbols, max_tokens)` – automatyczny dobór chunków pod budżet tokenów.
- Prosty TUI/HTML raport (rozmiary, rozkład języków, najcięższe pliki).
- Pluginy do VS Code/JetBrains z przeglądarką chunków i kontekstu rozmów z LLM.
- Integracja z przeglądarką (web) dla self-service analizy repozytorium.

## Reguły domenowe
- Licencyjna filtracja (pomijanie folderów z licencją niedozwoloną).
- Anonimizacja PII w komentarzach/dokumentach (opcjonalna).
- Reguły branżowe (SOX/GDPR) jako zestawy predefiniowanych filtrów do konfiguracji.
- Raporty zgodności (logi decyzji filtrujących) do audytu.

## Format danych
- Eksport do Parquet/SQLite dla analityki.
- Kompatybilność z popularnymi wektorówkami (FAISS, Qdrant, pgvector) – adaptery.
- Snapshoty w formacie delta (tylko zmienione chunk/metadata).
- Generowanie manifestów (JSON/YAML) dla pipeline'ów MLOps.

## Obserwowalność i operacje
- Metryki Prometheus/OTel (czas tokenizacji, throughput, cache hit-rate).
- Dashboardy operacyjne (Grafana, Datadog) z alertami na degradacje jakości lub wydajności.
- Health-checki HTTP/gRPC oraz endpointy readiness/liveness.
- Profilery wbudowane (CPU/heap) i trace’owanie długotrwałych zadań.

## Szkic kontraktów MCP
- `list_files({ include?: string[], exclude?: string[] }) -> { files: { path, size, lang, hash }[] }`
- `list_chunks({ path?: string, lang?: string, max_tokens?: number }) -> { chunks: { id, path, start_line, end_line, token_count, hash }[] }`
- `get_chunk({ id }) -> { text, metadata }`
- `search_text({ query, path_glob?: string }) -> { matches: { path, line, excerpt }[] }`
- `context_pack({ targets: string[] | symbol[], max_tokens }) -> { chunks: Chunk[] }`
- `diff_chunks({ base_ref, head_ref }) -> { added: Chunk[], removed: Chunk[], modified: { before: Chunk, after: Chunk }[] }`

## Domyślne strategie chunkingu
- „By lines”: N linii z overlapem M (proste, szybkie).
- „By tokens”: N tokenów z overlapem M (stabilne względem modeli).
- „By syntax”: sekcje typu funkcja/klasa/moduł (wymaga parsera/ctags/tree-sitter).
- „Hybrid”: syntax, a gdy za duże – docięcie do budżetu tokenów.
- „Semantic merge”: łączenie powiązanych chunków w locie dla zapytań kontekstowych.

## Następne kroki (warto dodać)
- Głębsza analiza kodu: chunking semantyczny po AST (Tree-sitter) i symbolach (ctags).
- Indeks symboli (definicje, referencje), graf zależności pakietów.
- Mapowanie test ⇄ plik źródłowy (heurystyki po nazwach/ścieżkach).
- Generowanie embeddingów (konfigurowalne modele) i hybrydowe wyszukiwanie (BM25 + wektorowe + filtracja po metadanych).
- Integracja z platformami review (komentarze kontekstowe, autorskaplugin) i powiadomienia o zmianach jakości indeksu.
- Inteligentne profile chunkingu zależne od języka i stylu repo (uczenie ze statystyk historycznych).
- System rekomendacji kontekstu (podsuwanie najistotniejszych plików/symboli pod zapytanie użytkownika).
