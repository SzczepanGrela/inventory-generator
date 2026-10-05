# Status prac Inventory Generator (Work Status)

## 1. Rozgraniczenie Środowisk i Statusów (Separation of Boundaries)

Dla zachowania pełnej przejrzystości operacyjnej wprowadza się ścisłe rozróżnienie pomiędzy stanem kodu, testów, środowiska produkcyjnego oraz formalnej akceptacji:

- **Zaimplementowane w kodzie źródłowym**:
  - Rewizja bazowa `main`: `16ed383d2affb96a7a538ec935a7b3b7dd337257` (scalone PR #23, #24, #25).
  - PR A (#26): `fix/preserve-cache-throughout-recovery` – centralizacja ochrony cache, wyeliminowanie cichego nadpisywania przy dodawaniu produktu w trybie tymczasowym i na starcie bez ciasteczka preferencji, baner powrotu do recovery (`#recovery-banner`), odporność na błędy resetu.
  - PR B: `fix/operator-runbook-selectors-and-rollback` – wykonywalne selektory kontenerów (numeryczny database ID Coolify 4.3.14 oraz prefiks nazwy UUID), zabezpieczenie manualnego rollbacku przed aktywnymi (`queued`/`in_progress`) i nieznanymi (*uncertain*) wdrożeniami, spójne budżety czasowe faz wdrożenia/wycofania, ograniczenie pętli monitorowania sąsiadów (`curl --connect-timeout 2 --max-time 5`).
- **Przetestowane w CI**:
  - 84 testy .NET Core (58 jednostkowych, 26 integracyjnych, w tym Kestrel streamed HTTP 413 i brak payloadu w logach).
  - 20 testów Pythona (w tym testy kontraktu Coolify, odporności na niepewne/aktywne wdrożenia oraz testy dymne smokecheck).
  - 12 scenariuszy E2E Playwright w odizolowanych kontekstach przeglądarki (w tym reprodukcje 5001 wierszy i brak cookie preferencji).
- **Wdrożone na produkcję (Live VPS)**:
  - Commit SHA: `9a2dee631f4aff76dc2024d3036287ad93216452` (PR #18, .NET 10 LTS).
  - Publiczny punkt kontrolny: `https://inventory-generator.grela.dev` (odczyt publiczny z dnia 2026-10-04 potwierdza wersję `9a2dee6...`).
  - **Żadne późniejsze zmiany z gałęzi `main` (w tym PR #23, #24, #25, #26) nie zostały wdrożone na serwer produkcyjny VPS**. Wdrożenie produkcyjne pozostaje celowo niewykonane i niezatwierdzone w GitHub Actions do czasu ukończenia procedury odbioru.
- **Formalnie zaakceptowane przez koordynatora (Audyt 2026-10-04 / IC04)**:
  - Zadania **D02.3a** (bezpieczeństwo eksportu i nagłówki CSP/nosniff/HSTS) oraz **D02.3d** (kontrakt Coolify, izolacja cgroups i uruchomienie nie-root) są **zaakceptowane**.
  - Zadania **D02.3b, D02.3c, D02.3e, D02.3f** pozostają **otwarte / w toku**:
    - D02.3c & D02.3f: Zaadresowane w otwartych do review PR-ach A (#26) i B.
    - D02.3b: Wymaga kwalifikacji obciążenia DOCX/CSV/HTML pod limitami 1 CPU / 512 MiB w skoordynowanym oknie (3 sloty no-wait nie stanowią bezwarunkowego dowodu wyeliminowania OOM).
    - D02.3e: Testy awaryjne/rollbacku na żywym VPS wymagają odrębnego okna operacyjnego z progami zatrzymania.
  - Ogólny stan zaawansowania projektu na roadmapie: **80%** (PR #13 w `grela-dev-roadmap`, PR #53 w `grela-dev-infrastructure`).
  - Projekt **nie jest ukończony w 100%** i nie składa niepopartych twierdzeń o całkowitym wyeliminowaniu OOM.

---

## 2. Szczegółowy stan prac w obszarach zadaniowych

### Obszar A: Architektura eksportu i współbieżność (IC03-2) - [Scalono w PR #23]
- **Strumieniowanie DOCX**: `DocxGenerator` oparty na `OpenXmlWriter` zapisuje strukturę wiersz-po-wierszu bezpośrednio do strumienia odpowiedzi, redukując retencję obiektów w pamięci względem pełnego drzewa DOM.
- **Konserwatywny semafor współbieżności (3 sloty, no-wait)**:
  - Limit 3 równoległych operacji eksportu dla wszystkich formatów (DOCX, CSV, HTML) w `ExportRateLimiter`.
  - Natychmiastowe odrzucenie nadmiarowych żądań z kodem `HTTP 429 Too Many Requests` (`Retry-After: 1`, brak nieograniczonej kolejki FIFO w pamięci).
- **Rzetelne pomiary wydajnościowe (`BenchmarkTests`)**:
  - `LiveManagedHeapDelta` precyzyjnie opisuje zmianę rozmiaru sterty zarządzanej raportowaną przez `GC.GetTotalMemory`, a nie całkowitą sumę alokacji.
  - Pomiar Working Set oznaczony jako `ProcessWorkingSetAfterCompletion` (wskazuje stan po zakończeniu, nie szczytowy profiler ciągły).
  - Trzy zróżnicowane syntetyczne kształty tabel (szeroka 50x1k, długa 10x5k, gęsta 25x1k).

### Obszar B: Integralność danych i bezpieczne logowanie (IC03-1, IC03-3, IC04-1) - [Scalono w PR #24, poprawki w PR A #26]
- **Ochrona lokalnego cache przed nadpisaniem**:
  - Scentralizowany strażnik w `saveAttributesToLocalStorage` i `saveProductsToLocalStorage` blokuje destrukcyjne zapisy w trakcie sesji awaryjnej (`corruptedCache`).
  - Rozdzielenie ładowania tłumaczeń (`loadTranslations`) od utrwalania domyślnych atrybutów: `loadLanguage` nie nadpisuje błędnego cache przed walidacją na starcie aplikacji.
  - Dodanie stałego banera ratunkowego (`#recovery-banner`) z przyciskiem `#reopen-recovery-btn`, umożliwiającego powrót do pobrania surowego zrzutu danych lub jawnego resetu.
  - Spójna obsługa błędów sieciowych: nieudana próba pobrania szablonu domyślnego nie zamyka modalu ani nie udaje pomyślnego resetu.
- **Logi serwerowe bez danych użytkownika (`Program.cs`, `PayloadValidator.cs`)**:
  - Ustrukturyzowane kody błędów (`ValidationOutcome`) – logowane wyłącznie metadane (`ClientIp`, `Format`, `ErrorCode`, `ColumnsCount`, `RowsCount`). Żadna nazwa kolumny użytkownika ani klucz atrybutu nie trafia do logów.

### Obszar C: Procedury operatorskie i testy integracyjne (IC03-4, IC03-5, IC04-2) - [Scalono w PR #25, poprawki w PR B]
- **Wykonywalny runbook operatorski (`docs/operator-procedures.md`)**:
  - Selektor kontenera zoptymalizowany pod Coolify 4.3.14: wykorzystanie numerycznego database ID (`APP_NUMERIC_ID` z endpointu `/api/v1/applications/<UUID>`) z fallbackiem na unikalny prefiks nazwy kontenera dla danego UUID.
  - Zabezpieczenie manualnego rollbacku: Opcja A (GitHub Actions) jako podstawowa ścieżka zserializowana; Opcja B wzbogacona o weryfikację braku aktywnych (`queued`, `in_progress`) oraz niepewnych wdrożeń w API przed wykonaniem mutacji.
  - Zgodne z rzeczywistością opisy limitów czasowych: wyodrębnienie procedury normalnej promocji (z oknem `soak_release`) od szybkiego rollbacku awaryjnego (z odpytywaniem rewizji i punktu zdrowia bez fazy soak).
  - Ograniczenie monitorowania sąsiadów: pętla `curl` z flagami `--connect-timeout 2 --max-time 5` oraz skończoną liczbą 30 iteracji (60s).
- **Rozszerzone testy offline**:
  - Regresja Kestrel chunked body HTTP 413 dla zapytań > 2 MiB.
  - 20 testów Pythona sprawdzających kontrakty, odrzucanie wdrożeń przy aktywnych konfliktach oraz zachowanie przy nieznanych statusach.
  - 12 scenariuszy przeglądarkowych Playwright.

---

## 3. Zestawienie Otwartej Ścieżki Wydania (Open PRs)

Zgodnie z wytycznymi koordynatora, nowe PR-y pozostają otwarte do przeglądu i nie są łączone metodą merge przed autoryzacją:

1. **PR A (Ochrona Cache w Całym Cyklu Recovery)**:
   - Branch: `fix/preserve-cache-throughout-recovery` -> PR #26
   - Status: Otwarty, zielone CI.
2. **PR B (Wykonywalne Procedury Operatorskie i Bezpieczny Rollback)**:
   - Branch: `fix/operator-runbook-selectors-and-rollback`
   - Status: W trakcie przygotowania do utworzenia PR.
