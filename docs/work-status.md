# Status prac Inventory Generator (Work Status)

## 1. Podział statusu (Separation of Boundaries)

- **Aktywna wersja produkcyjna (Live VPS)**:
  - Commit SHA: `9a2dee631f4aff76dc2024d3036287ad93216452` (PR #18, .NET 10 LTS)
  - Środowisko: `https://inventory-generator.grela.dev`
  - Weryfikacja: `GET /api/health` zwraca 200 OK / SHA `9a2dee6...`; nagłówki CSP, nosniff, DENY, HSTS; `POST /api/export/csv` z `{"attributes": [null]}` zwraca 400 Bad Request.
  - Rewizje `520be2c` (PR #21) oraz `1410c48` (PR #22) zostały scalone do `main`, ale **nie zostały wdrożone na produkcję** (decyzja wstrzymana do czasu zakończenia przeglądu poprawek).
- **Gałąź główna (main)**: `675168113a6cf0fb5d6980d9bb398b36d67bcef0` (scalony PR #23, chroniona rulesetem `#24407679`, wymóg PR i zielonego `Quality gate`).
- **Status akceptacji koordynatora (Audyt 2026-10-03 / IC03-S–P)**:
  - Zadania D02.3a/d: Zaakceptowane.
  - Zadania D02.3b/c/e/f: Częściowe / Otwarte (wymagają realizacji korekt IC03-1–5).
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

### Obszar B: Bezpieczeństwo danych i logowanie (IC03-1 & IC03-3) - [Wdrożone w PR 2]
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

### Obszar C: Procedury operatorskie i testy E2E (w trakcie realizacji w PR 3)
- Do poprawy (IC03-4 & IC03-5):
  - Poprawa poleceń w runbooku operatorskim (`docs/operator-procedures.md`): nazwa wejścia workflow `digest`, nazwane argumenty `--base-url` w `smokecheck.py`, jednoznaczna rezolucja ID kontenera, poprawna domena `tictactoe.grela.dev`, uściślenie pojęć skanera (`ignore-unfixed`) i wskaźników OOM / CPU.
  - Rozszerzenie scenariuszy przeglądarkowych Playwright o rzeczywiste pobieranie plików, obsługę błędów sieciowych, blokadę i odblokowanie przycisku przy kodzie 429.

---

## 3. Plan wdrożenia poprawek (Kolejność PR-ów)

1. **PR 1**: `fix/concurrency-and-capacity-measurements` – [SCALONO (#23)]
2. **PR 2 (niniejszy)**: `fix/data-preservation-and-payload-free-logs` – ochrona cache, eksport ratunkowy, ścisła walidacja typów w JS, logowanie oparte wyłącznie na kodach błędów (bez nazw kolumn).
3. **PR 3**: `fix/acceptance-runbook-and-browser-regressions` – korekta runbooka operatorskiego, rozbudowa testów przeglądarkowych Playwright i regresji Kestrel.

