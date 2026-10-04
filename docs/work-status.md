# Status prac Inventory Generator (Work Status)

## 1. Podział statusu (Separation of Boundaries)

- **Aktywna wersja produkcyjna (Live VPS)**:
  - Commit SHA: `9a2dee631f4aff76dc2024d3036287ad93216452` (PR #18, .NET 10 LTS)
  - Środowisko: `https://inventory-generator.grela.dev`
  - Weryfikacja: `GET /api/health` zwraca 200 OK / SHA `9a2dee6...`; nagłówki CSP, nosniff, DENY, HSTS; `POST /api/export/csv` z `{"attributes": [null]}` zwraca 400 Bad Request.
  - Rewizje `520be2c` (PR #21) oraz `1410c48` (PR #22) zostały scalone do `main`, ale **nie zostały wdrożone na produkcję** (decyzja wstrzymana do czasu zakończenia przeglądu poprawek).
- **Gałąź główna (main)**: `7e6756362c0802a9d781edaf46f0ae0ab6b50860` (scalony PR #24, chroniona rulesetem `#24407679`, wymóg PR i zielonego `Quality gate`).
- **Status akceptacji koordynatora (Audyt 2026-10-03 / IC03-S–P)**:
  - Zadania D02.3a/d: Zaakceptowane.
  - Zadania D02.3b/c/e/f: Częściowe / Otwarte (korekty IC03-1–5 zaimplementowane w PR-ach #23, #24 i niniejszym PR #25).
  - Stopień zaawansowania roadmapy: 80% (PR #13 w `grela-dev-roadmap`).
  - Usunięto bezwarunkowe roszczenia o "100% zamknięciu", "braku podatności" oraz "całkowitym braku OOM".

---

## 2. Stan prac w podziale na obszary

### Obszar A: Architektura eksportu i współbieżność (IC03-2) - [Scalono w PR #23]
- **Strumieniowanie DOCX**: Zachowano optymalizację w `DocxGenerator` opartą na `OpenXmlWriter`. Zapis wiersz-po-wierszu redukuje retencję obiektów w pamięci względem pełnego drzewa DOM.
- **Konserwatywny semafor współbieżności (3 sloty, no-wait)**:
  - Przywrócono produkcyjny limit **3 równoczesnych slotów** w `ExportRateLimiter` (`maxConcurrency = 3`).
  - Przywrócono natychmiastową odmowę wstępu (`TimeSpan.Zero`) w `Program.cs` – żądania przy zajętych 3 slotach otrzymują natychmiast `HTTP 429 Too Many Requests` (`Retry-After: 1`).
  - Wyeliminowano nieograniczoną czasowo kolejkę oczekujących żądań w pamięci.
- **Pomiary wydajnościowe (`BenchmarkTests`)**:
  - Poprawiono etykiety: `LiveManagedHeapDelta` precyzyjnie opisuje różnicę sterty zarządzanej mierzoną przez `GC.GetTotalMemory`, a nie całkowitą sumę alokacji bajtowych.
  - Próbka Working Set po zakończeniu funkcji została oznaczona jako `ProcessWorkingSetAfterCompletion` (nie jako szczytowy profiler ciągły).
  - Dodano test z trzema odrębnymi zestawami danych o zróżnicowanych kształtach brzegowych (tabela szeroka 50x1k, tabela długa 10x5k, tabela gęsta 25x1k ze zwiększonym tekstem).

### Obszar B: Bezpieczeństwo danych i logowanie (IC03-1 & IC03-3) - [Scalono w PR #24]
- **Ochrona lokalnego cache (`wwwroot/js/app.js`, `wwwroot/index.html`)**:
  - Surowy cache w `localStorage` jest w pełni zachowywany w razie błędu walidacji lub przekroczenia limitu 5000 wierszy (brak destrukcyjnego nadpisywania pustym `[]`).
  - Wprowadzono modal ratunkowy (`#recovery-modal`) z możliwością pobrania surowego zrzutu danych JSON oraz jawnym przyciskiem zresetowania projektu do domyślnego szablonu.
  - Obsłużono tryb bezpiecznej pracy w pamięci podręcznej po odrzuceniu modalu bez utraty danych z `localStorage`.
- **Ścisła walidacja i kompatybilność schematu (`sanitizeProjectData`)**:
  - Wstecznie kompatybilne wartości domyślne dla brakujących pól legacy (`String`, `columnWidth: 800`, `canBeEmpty: true`, `isBold: false`, itp.).
  - Ścisłe odrzucanie nieprawidłowych typów: nieznane typy rzucają błąd (brak cichej koercji do `String`); nie-boolean (np. string `"false"`) rzuca błąd; `null` lub brak słownika produktów rzuca błąd.
- **Eliminacja nazw kolumn i treści komórek z logów (`Program.cs`, `PayloadValidator.cs`)**:
  - Wprowadzono `ValidationOutcome` z ustrukturyzowanymi, ograniczonymi kodami błędów (`INVALID_ATTRIBUTE_TYPE`, `DUPLICATE_ATTRIBUTE_NAME`, `MAX_ROWS_EXCEEDED`, itp.).
  - `Program.cs` loguje wyłącznie: `ClientIp`, `Format`, `ErrorCode`, `ColumnsCount`, `RowsCount` – ani jedna nazwa kolumny użytkownika ani klucz atrybutu nie trafia do logów serwera.
- **Testy regresyjne**:
  - `ExportValidationLoggingTests.cs` – 3 testy integracyjne weryfikujące, że wrażliwe/syntetyczne nazwy kolumn i kluczy nigdy nie pojawiają się w logach serwera.
  - `test-browser.mjs` (Test 7) – weryfikacja odrzucania nieznanych typów, `"false"`, `null` w słownikach, zachowania 5001 wierszy w `localStorage` oraz bezpiecznego importu plików.

### Obszar C: Procedury operatorskie i testy E2E (IC03-4 & IC03-5) - [Wdrożone w PR 3]
- **Korekta runbooka operatorskiego (`docs/operator-procedures.md`)**:
  - Poprawiono parametr wywołania rollbacku: `digest` zamiast błędnego `target_digest`.
  - Zaktualizowano polecenie `infra.smokecheck` z flagami `--base-url` oraz `--expected-revision`.
  - Dodano jednoznaczną rezolucję kontenera w Coolify z obsługą potencjalnego nakładania się instancji (*rolling overlap*).
  - Poprawiono domenę sąsiedniej aplikacji na `tictactoe.grela.dev` (zamiast `ttt.grela.dev`).
  - Uściślono zakres semafora (3 sloty dla wszystkich formatów: DOCX, CSV i HTML, z natychmiastowym 429).
  - Sprecyzowano kryteria bezpieczeństwa: skan podatności uwzględniający `ignore-unfixed: true`, rozróżnienie wskaźnika *load average* od procentowego zużycia CPU oraz weryfikację zdarzeń OOM przez `State.OOMKilled` i cgroup v2 `memory.events` (zamiast samego kodu wyjścia 137).
  - Usunięto nieuzasadnione twierdzenie o "natychmiastowym" rollbacku na rzecz procedury ze zdefiniowanym czasem oczekiwania i weryfikacją.
- **Test regresyjny chunked stream Kestrel (`RealKestrelStreamedRegressionTests.cs`)**:
  - Dodano test uruchamiający rzeczywisty proces Kestrel na gnieździe TCP loopback weryfikujący natychmiastowe zwracanie statusu HTTP 413 Payload Too Large przy strumieniowaniu chunked body > 2 MiB.
- **Rozszerzenie scenariuszy Playwright (`tests/browser/test-browser.mjs`)**:
  - Dodano testy pobierania plików (CSV, DOCX, HTML, JSON) z weryfikacją nagłówków, rozszerzeń i zawartości.
  - Dodano test responsywnego widoku mobilnego (375x667) z weryfikacją ukrywania elementów `.hide-mobile` i braku poziomego przepełnienia strony.
  - Dodano test pułapki fokusu Tab (w przód i w tył) oraz przywracania fokusu do wywołującego przycisku po zamknięciu modalu klawiszem Escape.
  - Dodano test blokady przycisku eksportu i automatycznego odblokowania po odliczeniu czasu przy kodzie HTTP 429.
  - Dodano test odporności na błędy sieciowe (route abort) z zachowaniem danych w pamięci.
- **Poprawka w `wwwroot/js/app.js`**:
  - Dodano brakujące powiązanie elementu `documentPreviewContainer` w obiekcie `elements`, zapobiegające błędowi `TypeError` podczas otwierania podglądu dokumentu.

---

## 3. Plan wdrożenia poprawek (Kolejność PR-ów)

1. **PR 1**: `fix/concurrency-and-capacity-measurements` – [SCALONO (#23)]
2. **PR 2**: `fix/data-preservation-and-payload-free-logs` – [SCALONO (#24)]
3. **PR 3 (niniejszy)**: `fix/acceptance-runbook-and-browser-regressions` – korekta runbooka operatorskiego, regresja Real Kestrel 413, rozbudowa testów przeglądarkowych Playwright o 12 pełnych scenariuszy.

