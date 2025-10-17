# repo-tokenizer rollout plan

# Stage 0

## Phase 0 - Project preparation
- [x] Approve the feature scope and delivery priorities based on `features.md`.
- [x] Define the high level architecture (ingest pipeline -> chunking -> storage -> API) together with a flow diagram.
- [x] Choose the technology stack (language, frameworks, storage) and create the repository with the base directory structure.
- [x] Configure automation: CI with lint/test, basic security rules, PR/issue templates.

## Phase 1 - Repository handling
- [x] Implement Git repository ingestion (local and remote) with branch/commit/tag awareness.
- [x] Respect `.gitignore`, `global .gitignore`, and `.git/info/exclude` plus allow extra glob/regex patterns.
- [x] Detect monorepos and support scoping by workspace (npm/yarn/go) as well as paths/packages.
- [x] Support read only snapshots and operation on archives (`.tar`, `.zip`) and plain directories.
- [x] Implement sparse checkout/sparse index mode for very large repositories.
- [x] Allow pinning to a commit or merge base and produce deterministic snapshots (hash plus metadata).

## Phase 2 - Tokenisation and chunking
- [x] Design the tokenizer plugin interface and implement adapters (for example tiktoken, sentencepiece).
- [x] Deliver core chunking modes: fixed size (lines, tokens), sliding window, and by file section.
- [x] Add adaptive chunking (merging small files, splitting large files) and configurable overlaps.
- [x] Implement a context budget with automatic chunk sizing relative to token limits.
- [x] Generate stable chunk identifiers (content hash plus path) with deterministic sorting.
- [x] Prepare comparative chunking tests (different languages, small/large files).

## Phase 3 - Content normalisation and filtering
- [x] Detect and skip binary or oversized files based on size, extension, and MIME heuristics.
- [x] Auto detect generated artefacts (`dist`, `build`, `.min.js`, `vendor`) and common noise (licence boilerplate).
- [x] Normalise end of line characters, remove BOM, and trim trailing whitespace per configuration.
- [x] Implement content deduplication (hash) and sanitisation rules (secrets, banned tokens, generated comments).
- [x] Document filtering mechanics and expose a way to test patterns (for example dry run mode).

## Phase 4 - API, export, and CLI
- [x] Implement the MCP server with tools `list_files`, `get_file`, `list_chunks`, `get_chunk`, `search_text`, `search_symbols`.
- [x] Provide JSONL and SQLite export formats with result streaming and back pressure control.
- [x] Prepare reference SDKs/clients (Node.js/Python) and generate the OpenAPI spec.
- [x] Add webhook/queue delivery (SQS/NATS) for asynchronous exports.
- [x] Ship the CLI (`init`, `index`, `serve`, `export`) with YAML/TOML configuration, profiles, and shell completion.
- [x] Document the API, CLI, and example integration flows.

## Phase 5 - Incremental updates and security
- [x] Implement diff analysis (git diff versus last snapshot) and tokenisation cache keyed by content hash.
- [x] Add watch mode (fsnotify/inotify) and scheduled reindexing (cron/CI).
- [x] Provide secret masking, integration with external scanners, and redaction for logs/exports.
- [x] Ensure export encryption (AES/GPG) plus hash signatures (SHA-256) for integrity verification.
- [x] Confirm air gap compliance (no telemetry, no network dependencies in offline mode).

## Phase 6 - Integrations, performance, and observability
- [x] Support Git submodules, Git LFS, and worktrees in the ingest pipeline.
- [x] Deliver GitHub/GitLab integrations (PR diff indexing, summaries, status checks).
- [x] Prepare hooks (pre-commit, CI "index repo" job) and metrics export for pipelines.
- [x] Implement parallel processing, IO back pressure, index sharding, and resume mechanisms.
- [x] Provide Prometheus/OTel metrics, Grafana/Datadog dashboards, and readiness/liveness health checks.
- [x] Integrate CPU/heap profilers and tracing for long running jobs.

## Phase 7 - Developer experience and interfaces
- [x] Offer verbose logging (levels), dry run mode, and chunk quality/diff reports.
- [x] Prepare sample repositories (JS/TS, Python, Java, Go, Rust) and a dataset generator.
- [x] Create a TUI/HTML report (sizes, language mix, heaviest files) and IDE plugins (VS Code/JetBrains).
- [x] Build web self service integration and MCP tools (`diff_chunks`, `blame`, `resolve_ref`, `context_pack`).
- [x] Document best practices and ship tutorials/developer guides.

## Phase 8 - Domain rules, formats, and future work
- [x] Implement licence based filtering, PII anonymisation, and regulatory rule sets (SOX/GDPR).
- [x] Add Parquet export, delta snapshots, and MLOps manifests plus adapters for FAISS/Qdrant/pgvector.
- [x] Design and implement the context recommendation system and language specific chunking profiles.
- [x] Build test to source file mapping and the symbol index/dependency graph.
- [x] Prepare the roadmap for embeddings, hybrid search, and quality alerts.

## Phase 9 - Dependency modernisation
- [x] Replace `glob@7.x` with version `^9` (or a compatible alternative) and verify the impact on code.
- [x] Remove `inflight@1.0.6`, migrating to the recommended approach (`lru-cache` or native promise caching).
- [x] Upgrade `rimraf` to `^4` and update build/cleanup scripts.
- [x] Replace `@humanwhocodes/config-array` and `@humanwhocodes/object-schema` with the new `@eslint/*` packages.
- [x] Update `eslint` to a supported release aligned with the ESLint support policy.

## Phase 10 - Stability and documentation
- [ ] Fix `README.md` (remove NUL characters, restore baseline project documentation).
- [ ] Align shared types (for example `IndexOptions` vs `IndexingConfig`) and ensure `npm run build/test` pass in strict mode.
- [ ] Add an efficient file system diff for repositories (mtime/hash cache) and cover watch/incremental scenarios with tests.
- [ ] Provide fallback detection for `tar`/`unzip` in `openArchive` plus tests for missing tooling.
- [ ] Review build configuration (`tsconfig.rootDir`) and decide whether to publish `dist/` to VCS.

## Phase 11 - MCP server channel rollout
- [x] Skatalogować operacje dostępne w obecnym REST (`GET/POST/...`), wymagane dane wejścia/wyjścia i konteksty użytkownika; nadać priorytety funkcjom, które przechodzą do kanału MCP w pierwszej kolejności. (docs/mcp/channel-rollout.md#L5)
- [x] Zdefiniować manifest MCP: nazwa, capabilities (narzędzia, eventy, kanały), wymagane role oraz format komunikatów; wskazać akcje synchroniczne vs strumienie zdarzeń. (docs/mcp/channel-rollout.md#L27)
- [x] Zaprojektować warstwę adaptera tłumaczącą wywołania MCP na serwisy domenowe zamiast delegować bezpośrednio do kontrolerów REST (warstwa współdzielona). (docs/mcp/channel-rollout.md#L67)
- [x] Ustalić strategię autoryzacji i identyfikacji klientów MCP (tokeny serwisowe, integracja z OAuth), razem z wymaganiami bezpieczeństwa (rate limiting, audyt). (docs/mcp/channel-rollout.md#L76)
- [x] Przygotować szkic kontraktów (OpenAPI → JSON Schema → definicje narzędzi MCP) i ustalić zasady wersjonowania oraz kompatybilności. (docs/mcp/channel-rollout.md#L84)
- [x] Zaplanować sekcję testów: walidacja kontraktów, scenariusze e2e z klientem MCP, testy obciążeniowe krytycznych komend oraz narzędzia do automatyzacji. (docs/mcp/channel-rollout.md#L93)
- [x] Opracować harmonogram wdrożenia: MVP (kluczowe akcje), beta (feedback partnerów), GA (pełne pokrycie REST + monitoring i alerty). (docs/mcp/channel-rollout.md#L101)
- [x] Utworzyć tabelę „REST → MCP capability” jako artefakt śledzący migrację i postęp prac. (docs/mcp/channel-rollout.md#L5)
- [x] Przeprowadzić warsztat z zespołem bezpieczeństwa w celu zatwierdzenia modelu autoryzacji MCP i wymagań audytowych. (docs/mcp/channel-rollout.md#L109)

## Phase 12 - MCP hardening and lifecycle
- [ ] Dokończyć implementację strumieniowania zasobów MCP (chunked export, progresywne odpowiedzi) z obsługą back pressure.
  - Ujednolicić API strumieniowe (`export_jsonl`, `index_repository`) i zaprojektować protokół ACK dla chunków.
    - Spisać specyfikację formatu ramek i kontrakt testowy dla klientów MCP/REST.
  - Obsłużyć nagłówki opisujące rozmiar paczki i limit throughput po stronie klienta.
    - Zaprojektować konfigurację limitów (CLI/TOML) i scenariusze throttlingu w dokumentacji.
  - Zabezpieczyć strumienie testami integracyjnymi (duże pliki, throttling, zrywanie połączenia).
    - Zbudować zestaw testów end-to-end z syntetycznymi repozytoriami >10GB i raportem wyników.
- [ ] Wprowadzić negocjację wersji manifestu oraz kontrolę kompatybilności narzędzi per klient.
  - Dodać pole `manifestVersion` w handshake i listę wspieranych rewizji narzędzi.
    - Udostępnić migrację manifestów w CLI (`manifest diff`) i przykłady komunikatów.
  - Wdrożyć fallback (np. downgrade do `v1beta`) oraz jasne komunikaty błędów.
    - Przygotować bibliotekę kodów błędów + mapowanie na statusy HTTP/WebSocket.
  - Udokumentować proces deprecjacji narzędzi i politykę wersjonowania.
    - Opracować timeline wycofań i checklistę komunikacji z partnerami (mail/slack).
- [ ] Zaimplementować mechanizm keep-alive/heartbeat i automatyczne odtwarzanie sesji dla długo działających połączeń.
  - Publikować okresowe `ping`/`pong` w tle z konfiguracją timeoutów.
    - Zaimplementować monitor w CLI (`serve status`) pokazujący RTT i uptime sesji.
  - Zapisać kontekst sesji (ostatnie kursory, subskrypcje) i przywracać po reconnect.
    - Stworzyć magazyn stanu (in-memory + opcjonalnie Redis) z szyfrowaniem w spoczynku.
  - Dodać obserwabilność błędów połączeniowych (timeouts, resets).
    - Dodać dashboard „MCP Health” z korelacją błędów do wersji klienta.
- [ ] Dodać metryki MCP (liczniki wywołań, błędów, przepustowość) oraz alerty SLO.
  - Instrumentować liczniki per narzędzie, histogramy czasu i rozmiaru payloadów.
    - Ustandaryzować nazewnictwo metryk (`mcp_tool_duration_seconds`) i tagi (tenant, narzędzie).
  - Eksportować metryki do Prometheus + dashboard w Grafanie.
    - Przygotować plik dashboardu (JSON) oraz instrukcje importu.
  - Zdefiniować progi SLO (np. 99.5% powodzenia) i skonfigurować alerty.
    - Zaprogramować alertmanager rules i ćwiczenie „alert fire drill”.
- [ ] Przygotować testy zgodności protokołu z referencyjnymi klientami (Node/Python) i pipeline CI.
  - Zbudować harness uruchamiający scenariusze końcowe z różnymi wersjami klientów.
    - Dodać bazę przypadków (trace zapytań) oraz autoryzację tokenową w testach.
  - Włączyć testy do CI (matrix Node 18/20, Python 3.10/3.12).
    - Skonfigurować cache zależności i raport w formacie junit dla CI.
  - Dodawać raport kompatybilności do release notes.
    - Automatycznie generować tabelę zgodności w `docs/releases.md`.

## Phase 13 - SDK i ekosystem deweloperski
- [ ] Wygenerować typowane SDK (TypeScript, Python) na podstawie kontraktów MCP/REST i opublikować w rejestrach.
  - Wygenerować klienta z JSON Schema (OpenAPI Generator / custom) wraz z typami.
    - Przygotować testy kontraktowe porównujące wygenerowany kod z aktualnym API.
  - Skonfigurować CI release (npm/pypi) i semantyczne wersjonowanie.
    - Ustawić automatyczne tagowanie (`changesets`/`semantic-release`) i podpisy pakietów.
  - Dodać przykładowe skrypty wykorzystujące SDK w repo `examples/`.
    - Napisać tutorial „hello world” dla obu języków oraz nagranie krótkiego demo.
- [ ] Dostarczyć przykładowe integracje (VS Code task, GitHub Action, JetBrains) korzystające z SDK.
  - Rozszerzyć istniejące sample o pełny przepływ (index + context).
    - Zintegrować sample z CI, aby potwierdzać działanie przy każdym release.
  - Opracować GitHub Action `repo-tokenizer/index@v1`.
    - Dodać README z przykładami użycia (matrix, self-hosted runner) i polityką uprawnień.
  - Przygotować dokumentację krok po kroku dla integracji IDE.
    - Utworzyć sekcję FAQ z najczęstszymi problemami i debug checklistą.
- [ ] Zaimplementować generator scaffolding (`repo-tokenizer-mcp plugin create`) do uruchamiania nowych narzędzi.
  - Dostarczyć template repo (TypeScript) z przykładowym narzędziem.
    - Zapewnić integrację ze `pnpm`/`npm` i gotowe workflow GitHub Actions.
  - Obsłużyć konfigurację testów i publikacji pluginu.
    - Dodać sample testów (vitest) i komendę `npm run verify`.
  - Udostępnić checklistę jakości dla kontrybutorów.
    - Opublikować stronę „Contributor Guide” wraz ze wzorem PR.
- [ ] Przygotować „cookbook” z gotowymi scenariuszami (chatbot, automatyczne code review, rekomendacje pull requestów).
  - Spisać sekwencje wywołań MCP dla poszczególnych use-case.
    - Dołączyć diagramy przepływu (Mermaid) i JSON payloady.
  - Udokumentować wymagane role/konfigurację i limity.
    - Dodać tabelę porównawczą kosztów i sugerowanych ustawień.
  - Nagrywać krótkie screencasty demonstracyjne.
    - Wygenerować napisy/transkrypcje i udostępnić w repo `docs/assets`.
- [ ] Zebrać feedback early adopters i wprowadzić roadmapę funkcji dla partnerów.
  - Zorganizować program „design partner” z kwartalnymi wywiadami.
    - Przygotować szablon ankiety NPS oraz tracker insightów.
  - Stworzyć publiczny backlog feature requests i mechanizm głosowania.
    - Zaprojektować proces triage (kategorie, SLA odpowiedzi).
  - Raportować postępy partnerom (newsletter, changelog).
    - Automatyzować wysyłkę newslettera (Mailchimp/Sendgrid) z segmentacją odbiorców.

## Phase 14 - Rozproszona orkiestracja zadań
- [ ] Zaprojektować i wdrożyć kolejkę zadań indeksujących (np. Redis/SQS) z priorytetami i retry.
  - Określić format payloadów, retry policy i DLQ.
    - Sporządzić diagram sekwencji (enqueue -> worker -> ack) i scenariusze błędów.
  - Stworzyć moduł `TaskScheduler` integrujący się z MCP/CLI.
    - Zapewnić REST/MCP endpoint do podglądu stanu kolejki.
  - Przeprowadzić testy przeciążeniowe (setki zadań równocześnie).
    - Ustawić automatyczne raportowanie throughput i średniego czasu oczekiwania.
- [ ] Uruchomić skalowalne workery (container jobs) obsługujące równoległe indeksowanie wielu repozytoriów.
  - Przygotować kontener roboczy z minimalnym footprintem.
    - Zoptymalizować image (multi-stage) i zapewnić cache zależności.
  - Wprowadzić rejestr statusu zadań (pending/running/completed/failed).
    - Zbudować UI/CLI do filtrowania zadań według stanu i priorytetu.
  - Umożliwić konfigurację workerów per tenant/region.
    - Dodać walidację limitów (max workers) oraz dokumentację parametrów.
- [ ] Dodać cache współdzielony dla artefaktów (tokeny, snapshoty) oraz dedykowany storage na shardowane wyniki.
  - Zaprojektować strukturę katalogów dla shardów + TTL.
    - Przygotować migrację istniejących danych do nowego układu storage.
  - Wdrożyć warstwę cache (Redis/FS) z invalidacją na commit.
    - Napisać moduł walidacji cache (checksum) oraz cleanup job.
  - Zabezpieczyć storage przed konfliktami wersji (locki pesymistyczne).
    - Wprowadzić monitoring locków i alert w razie zakleszczeń.
- [ ] Wprowadzić kontrolę obciążenia (limit równoległych zadań per klient) i autoscaling na podstawie metryk.
  - Określić politykę limitów (hard/soft quotas) i komunikację błędów.
    - Udokumentować strukturę kodów błędów i rekomendacje dla klientów.
  - Spiąć auto-scaling z metrykami CPU/IO oraz backlogiem kolejki.
    - Utworzyć reguły scalingowe w K8s/HPA lub AWS ASG i test failback.
  - Przygotować narzędzia do manualnego throttlingu w sytuacjach awaryjnych.
    - Dodać komendy CLI `scheduler throttle/unthrottle` z audytem.
- [ ] Udokumentować proces instalacji w środowiskach chmurowych (AWS/GCP/Azure) z referencyjną architekturą.
  - Opracować diagramy architektury i checklisty konfiguracji.
    - Dołączyć pliki źródłowe diagramów (draw.io) i warianty HA.
  - Przygotować IaC przykłady (Terraform/CloudFormation).
    - Zbudować testowy pipeline IaC (lint, plan, apply w sandbox).
  - Opisać koszty operacyjne i rekomendacje optymalizacyjne.
    - Przygotować kalkulator kosztów oraz best practices oszczędnościowych.

## Phase 15 - Wielodostęp i kontrola dostępu
- [ ] Wprowadzić model organizacja/projekt z izolacją danych i konfiguracji indeksowania.
  - Zmienić schemat storage (prefiksy tenantów, separacja ACL).
    - Przygotować migratory danych oraz testy regresji dostępu.
  - Umożliwić dziedziczenie ustawień i override per projekt.
    - Dodać UI/CLI do podglądu hierarchii i efektywnych konfiguracji.
  - Aktualizować CLI/SDK o selektor `--project <id>`.
    - Zapewnić autouzupełnianie projektów i walidację uprawnień.
- [ ] Rozszerzyć role MCP o RBAC (reader/editor/maintainer/admin) z możliwością delegacji uprawnień.
  - Zdefiniować macierz uprawnień per narzędzie/event.
    - Opublikować specyfikację w `docs/security/rbac.md` z przykładami.
  - Dodać API do zarządzania członkami i zaproszeniami.
    - Zaimplementować tokeny zaproszeniowe z datą ważności i logowaniem akcji.
  - Przygotować migrację starych tokenów na nowy model.
    - Zapewnić narzędzia do rotacji kluczy i powiadomienia użytkowników.
- [ ] Dodać limity zapytań i indeksowań per token/tenant wraz z raportowaniem wykorzystania.
  - Śledzić liczniki per zakres czasu (dobowy/miesięczny).
    - Zaimplementować mechanizm resetu i eksportu CSV/JSON dla finansów.
  - Blokować/zegarować przy przekroczeniach i raportować w dashboardzie.
    - Dodać webhooki powiadomień i integrację z alertami email/SMS.
  - Eksportować użycie do fakturowania/billingu.
    - Spiąć z modułem billingowym (np. Stripe) i weryfikacją stawek.
- [ ] Zapisywać pełen audit log wywołań MCP/REST (parametry, identyfikacja klienta, wynik) i eksporotwać do SIEM.
  - Znormalizować format logów (JSON, timestamp, correlationId).
    - Zapewnić podpis cyfrowy logów (np. hash chain) dla spójności.
  - Zaimplementować sink do SIEM (Splunk/Datadog) i rotację danych.
    - Dodać konf. retencji oraz mechanizm automatycznych cleanupów.
  - Dodać raport audytowy dostępny z CLI.
    - Opracować generowanie PDF/CSV oraz filtrowanie po zakresie dat.
- [ ] Udostępnić panel administracyjny CLI/API do zarządzania tokenami i budżetami.
  - Rozszerzyć CLI o komendy `tenant token list/create/revoke`.
    - Wyposażyć komendy w tryb interaktywny oraz flagi non-interactive.
  - Dostarczyć widok webowy do przeglądu limitów.
    - Zapewnić sortowanie/filtry oraz eksport danych do arkusza.
  - Zapewnić mechanizm powiadomień e-mail/SMS o progach.
    - Wprowadzić szablony powiadomień i multi-channel fallback.

## Phase 16 - Strumień zmian i natychmiastowe aktualizacje
- [ ] Zaimplementować wykrywanie zmian „near real-time” (git hooks, watcher + debounce) i publikację delty poprzez MCP.
  - Obsłużyć różne źródła (local fs events, webhooks).
    - Stworzyć adaptery dla najpopularniejszych systemów (GitHub/GitLab/Bitbucket).
  - Optymalizować debouncing i łączenie zmian w paczki.
    - Dodać konfigurację progów i monitor efektywności (czas od zmiany do publikacji).
  - Emitować minimalne payloady (diffs, touched files).
    - Ustandaryzować schemat wiadomości i kontrakty JSON Schema.
- [ ] Dodać kanał eventów `indexing.progress` z granularnym stanem (kolejkowanie, chunking, eksport).
  - Zdefiniować schemat etapów i pól telemetrii.
    - Udostępnić przykład logowania progresu w CLI/TUI oraz w SDK.
  - Umożliwić subskrypcje selektywne (np. tylko `chunking`).
    - Wprowadzić filtry MCP (`subscribe?stage=chunking`) i testy.
  - Wizualizować w CLI/TUI progres w czasie rzeczywistym.
    - Zaprojektować layout TUI oraz tryb „quiet” dla CI.
- [ ] Zapewnić buforowanie zmian offline i późniejsze odtworzenie gdy połączenie MCP wróci.
  - Dodać lokalny bufor (sqlite/jsonl) z checkpointami.
    - Zaimplementować komendę diagnozy (`buffer status`) i statystyki.
  - Obsłużyć deduplikację i porządkowanie eventów po reconnect.
    - Użyć identyfikatorów monotonicznych i oczyszczania duplikatów.
  - Zaimplementować politykę TTL i limity rozmiaru bufora.
    - Wprowadzić alert w CLI/UI przy zbliżaniu się do limitu.
- [ ] Rozszerzyć CLI o tryb `serve --push-updates` do pracy jako lokalny agent synchronizujący.
  - Uruchomić lekki serwer MCP relay na stacji developera.
    - Obsłużyć auto-upgrade agentów i logowanie stanu.
  - Zapewnić autoryzację i ograniczenie zasięgu repo.
    - Wprowadzić listę dozwolonych ścieżek i whitelisting commitów.
  - Opisać przepływ pracy dla offline-first (np. pociągi, VPN).
    - Stworzyć tutorial oraz troubleshooting offline scenariuszy.
- [ ] Przygotować testy wydajnościowe dla dużych strumieni zmian (100k zdarzeń/h).
  - Zbudować generator syntetycznych zmian i harness porównujący throughput.
    - Umożliwić parametryzację rozmiaru repo, częstotliwości eventów.
  - Mierzyć opóźnienia end-to-end oraz zużycie CPU/RAM.
    - Zintegrować wyniki z Grafaną i historią trendów.
  - Ustawić progi alertów dla degradacji performance.
    - Zaimplementować automatyczne zgłoszenia (PagerDuty/Slack) przy przekroczeniu progów.

## Phase 17 - Zaawansowana analiza kodu
- [ ] Zbudować wielojęzyczny graf wywołań (call graph) oraz mapę zależności symboli pomiędzy modułami.
  - Wykorzystać parsery językowe (TS/Java/Python/Go) i zunifikować wynik.
    - Przygotować benchmark parserów i politykę cache AST.
  - Dodać persystencję grafu + API zapytań.
    - Udokumentować zapytania (np. top fan-in/out) i limitowanie wyników.
  - Zaimplementować wizualizację w raporcie HTML/TUI.
    - Dodać interaktywne filtry (po języku, module, głębokości).
- [ ] Wprowadzić heurystyki wykrywania długu technicznego (martwe pliki, duplikaty chunków, brak testów).
  - Opracować zestaw reguł scoringowych i progi alertów.
    - Skalibrować scoring na zestawie referencyjnym i zebrać feedback zespołu.
  - Wzbogacić pipeline o historyczne porównanie (poprzedni commit).
    - Zapisywać metryki w historii indeksów i umożliwić regresję czasową.
  - Zaprezentować wyniki w MCP (`diagnostics.list`) i raporcie.
    - Przygotować format eksportu (JSONL/CSV) do analizy BI.
- [ ] Generować automatyczne raporty trendów (z biegiem czasu) i udostępniać je przez MCP/CLI.
  - Gromadzić statystyki per run (rozmiar repo, liczba chunków).
    - Zbudować moduł agregacji (rolling averages, percentyle).
  - Budować wykresy trendów (HTML, JSON) i udostępniać API.
    - Osadzić wykresy w panelu webowym oraz CLI (`report trends`).
  - Wysyłać cykliczne raporty na webhook/email partnerów.
    - Wprowadzić harmonogramy i log sukces/błąd dostawy.
- [ ] Rozszerzyć rekomendacje o kontekst domenowy (policy findings, znalezione wzorce anty-patternów).
  - Połączyć wyniki DomainPolicyEngine z rekomendacjami.
    - Zmapować severity/policy tags na priorytety rekomendacji.
  - Dodać wagi/punkty priorytetu dla krytycznych znalezisk.
    - Zapewnić edytowalne profile scoringu per tenant.
  - Udostępnić filtry (np. „compliance”, „security”).
    - Wprowadzić API filtrów i dokumentację query stringów.
- [ ] Zintegrować się z zewnętrznymi źródłami wiedzy (issue tracker, incidents) dla pełnych insightów.
  - Zaimplementować konektory Jira/GitHub Issues/ServiceNow.
    - Obsłużyć dwukierunkową synchronizację statusu i komentarzy.
  - Wzbogacić raporty o odnośniki do otwartych problemów.
    - Dodawać metadane (np. SLA, owner) do prezentacji wyników.
  - Umożliwić automatyczne tworzenie ticketów na podstawie findings.
    - Konfigurować reguły (warunki, priorytet, szablony) w UI/CLI.

## Phase 18 - Embeddings i hybrydowe wyszukiwanie
- [ ] Wdrożyć pipeline generowania embeddingów (batched, async) z możliwością wyboru modelu (OpenAI, local).
  - Obsłużyć różne dostawców (HTTP, on-prem) i tryb kolejki.
    - Zaimplementować abstrakcję providerów z fallbackiem i monitorowaniem błędów.
  - Zapisać metadane embeddingów (model, wersja, timestamp).
    - Dodać migrację schematu storage oraz indeksy optymalizujące zapytania.
  - Zoptymalizować koszty przez deduplikację i scheduler nocy.
    - Wprowadzić raport kosztów dziennych oraz rekomendacje tuningowe.
- [ ] Zintegrować streaming wyników hybrydowych (BM25 + wektor) przez MCP `search_hybrid`.
  - Połączyć istniejące indeksy tekstowe z vektorowymi (fusion).
    - Wybrać strategię łączenia (reciprocal rank fusion) i udokumentować parametry.
  - Udostępnić parametry w zapytaniu (k, alpha, filtrowanie).
    - Wdrożyć walidację parametrów i wartości domyślne w SDK.
  - Wspierać strumieniowe dostarczanie wyników i metryki trafności.
    - Dodać feedback loop (ocena wyników) z zapisem do telemetry.
- [ ] Zaimplementować reranking (cross-encoder) oraz personalizację wyników względem historii użytkownika.
  - Włączyć moduł rerankingu w pipeline wyszukiwania.
    - Zbudować usługę inferencyjną (batch/online) z cachingiem wyników.
  - Kolekcjonować sygnały użytkownika (kliknięcia, oceny) zgodnie z polityką prywatności.
    - Wdrożyć kontrolę dostępu i anonimizację identyfikatorów użytkowników.
  - Umożliwić per-tenant konfigurację modeli rerankingu.
    - Udostępnić API zarządzania modelami (lista, aktywacja, fallback).
- [ ] Zapewnić mechanizmy odświeżania embeddingów przy zmianach dużych plików (partial re-embed).
  - Wykrywać zmiany fragmentów i re-embed tylko dotkniętych chunków.
    - Opracować algorytm mapowania zmian diff -> identyfikatory chunk.
  - Zastosować priorytety (np. pliki zasobów vs kod).
    - Ustalić klasy priorytetów i harmonogram wykonania.
  - Monitorować zaległości (lag) i raportować w dashboardzie.
    - Dodać wykres „embedding backlog” oraz alarm przy przekroczeniu progów.
- [ ] Dodać testy jakości (NDCG/MRR) na publicznych repo i raportować regresje.
  - Zbudować zestaw benchmarków i pipeline ewaluacyjny.
    - Zautomatyzować pobieranie danych testowych i sanity checks licencji.
  - Automatycznie porównywać nowe modele do baseline.
    - Generować raport PDF/HTML z wynikami i highlightami zmian.
  - Publikować wyniki w changelogach wydań.
    - Dodawać sekcję „search quality” w release notes i na stronie statusowej.

## Phase 19 - Panel webowy i automatyzacja workflow
- [ ] Stworzyć SPA (React/Svelte) pokazujące indeksy, status zadań, rekomendacje i alerty.
  - Zbudować API backendowe (GraphQL/REST) dla panelu.
    - Zaimplementować autoryzację (JWT/cookies) i cache front-endowy.
  - Zapewnić komponenty dostępności (ARIA) i responsywność.
    - Przeprowadzić audyt Lighthouse/axe i poprawić wykryte problemy.
  - Włączyć live-updates przez WebSocket/MCP events.
    - Dodać warstwę reconnection, batching eventów i testy obciążeniowe.
- [ ] Udostępnić konfigurację indeksowania z poziomu UI (include/exclude, profile chunkingu, harmonogramy).
  - Opracować formularze z walidacją i podpowiedziami.
    - Użyć biblioteki formularzy (React Hook Form) i testów e2e.
  - Synchronizować zmiany z repo `.repo-tokenizer.yaml`.
    - Zaimplementować diff wizualny i mechanizm konfliktów (merge).
  - Zaimplementować kontrolę wersji konfiguracji (history, rollback).
    - Przechowywać rewizje w storage + UI z timeline i rollbackiem.
- [ ] Zaimplementować kreator workflow (np. automatyczne wysyłanie raportów do Slacka/Teams).
  - Zapewnić zestaw predefiniowanych szablonów (alert, raport, eksport).
    - Przygotować marketplace workflow i mechanizm wersjonowania.
  - Integracja z Slack/Teams/Email przez webhooks.
    - Zaimplementować test webhooka oraz logowanie odpowiedzi.
  - Umożliwić testowanie workflow w UI przed publikacją.
    - Dodać tryb „sandbox run” z symulowanymi danymi.
- [ ] Wprowadzić mechanizm raportów mailowych (dzienne/tygodniowe) z wybranymi metrykami.
  - Generować raporty HTML/PDF i zarządzać subskrypcjami.
    - Przygotować szablony MJML i pipeline renderowania.
  - Obsłużyć harmonogram CRON i retry w razie błędów.
    - Rejestrować historię wysyłek oraz powody niepowodzeń.
  - Monitorować dostarczalność (błędy SMTP, bounce rate).
    - Zintegrować z narzędziem (Postmark/Sendgrid) i raportować statystyki.
- [ ] Dodać integrację SSO (SAML/OIDC) dla panelu oraz obsługę ról zgodnie z RBAC.
  - Wdrażać providerów (Azure AD, Okta, Google Workspace).
    - Stworzyć skrypty konfiguracyjne i dokumentację onboardingową.
  - Mapować atrybuty SSO na role i tenanty.
    - Wprowadzić testy automatyczne mapowania i fallback default role.
  - Przeprowadzić pentest/assurance logowania.
    - Zorganizować zewnętrzny audyt i zaadresować rekomendacje.

## Phase 20 - Packaging i wdrożenia
- [ ] Przygotować obrazy kontenerowe (multi-arch) oraz publikację w GHCR/ECR.
  - Zbudować pipeline multi-stage (alpine/distroless).
  - Podpisać obrazy (cosign) i dołączyć SBOM.
  - Utrzymywać tagi wersji i kanały release (stable/beta).
- [ ] Dostarczyć Helm Chart / Terraform module z opcjonalnymi komponentami (queue, storage, metrics).
  - Rozdzielić moduły (core, workers, ingress).
  - Zapewnić wartości domyślne + dokumentację override.
  - Przetestować instalację w kind/minikube i chmurach managed.
- [ ] Zautomatyzować aktualizacje (rolling upgrades, migracje schematów) oraz rollback.
  - Przygotować migratory storage (script + migracje wsteczne).
  - Ustawić health-checki i pre-stop hooks dla zero downtime.
  - Wdrożyć `kubectl rollout undo`/`terraform apply` scenariusze.
- [ ] Opracować scenariusze disaster recovery (backup indeksów, replikacja storage).
  - Skonfigurować backup (snapshots, off-site) i testy odtwarzania.
  - Zaplanować RPO/RTO oraz runbook DR.
  - Włączyć alerty o nieudanych backupach.
- [ ] Dodać testy infrastrukturalne (smoke tests) uruchamiane po wdrożeniu.
  - Stworzyć pakiet smoke tests (health, MCP connectivity, indexing).
  - Uruchamiać po każdym deploy (CI/CD pipeline).
  - Raportować wyniki do obserwability + Slack.

## Phase 21 - Niezawodność i compliance enterprise
- [ ] Zdefiniować SLO (czas odpowiedzi MCP/REST, sukces indeksowań) i wdrożyć monitorowanie zgodności.
  - Określić metryki i targety (latency p95, error rate).
  - Ustawić dashboard SLO + alerty o naruszeniach.
  - Wprowadzić tygodniowe raporty SLO dla zespołu.
- [ ] Przeprowadzić testy chaos engineering (awarie workerów, sieci) oraz przygotować runbooki.
  - Zaplanować eksperymenty (kill pod, latency injection, loss).
  - Dokumentować obserwacje i usprawnienia.
  - Aktualizować runbooki operacyjne i playbooki on-call.
- [ ] Wprowadzić polityki retencji danych, mechanizmy „right to be forgotten” i anonimisation request flow.
  - Opracować konfigurację retention per tenant/region.
  - Dodać API do usuwania danych użytkownika (identyfikacja, potwierdzenie).
  - Logować i audytować wykonanie żądań prywatności.
- [ ] Uzyskać zgodność z normami (SOC2 Type II, ISO 27001) oraz zebrać artefakty dowodowe.
  - Przygotować kontrolki bezpieczeństwa/operacyjne i dowody (screenshots, raporty).
  - Zorganizować audyt wewnętrzny i pre-assessment z zewnętrznym partnerem.
  - Zaplanować harmonogram certyfikacji i utrzymania zgodności.
- [ ] Zorganizować bug bounty/internal security review i zamknąć krytyczne ryzyka.
  - Uruchomić program nagród (platforma HackerOne/Bugcrowd).
  - Reagować na zgłoszenia według SLA i utrzymywać tracker.
  - Publikować raport bezpieczeństwa po każdej rundzie.
