# Status prac Inventory Generator (Work Status)

## 1. Podział statusu (Separation of Boundaries)

- **Aktywna wersja produkcyjna (Live VPS)**:
  - Commit SHA: `9a2dee631f4aff76dc2024d3036287ad93216452` (PR #18, .NET 10 LTS)
  - Środowisko: `https://inventory-generator.grela.dev`
  - Weryfikacja: `GET /api/health` zwraca 200 OK / SHA `9a2dee6...`; nagłówki CSP, nosniff, DENY, HSTS; `POST /api/export/csv` z `{"attributes": [null]}` zwraca 400 Bad Request.
  - Rewizje `520be2c` (PR #21) oraz `1410c48` (PR #22) zostały scalone do `main`, ale **nie zostały wdrożone na produkcję** (decyzja wstrzymana do czasu zakończenia przeglądu poprawek).
- **Gałąź główna (main)**: `1410c48fd7a6184da990e50361da6725962007eb` (chroniona rulesetem `#24407679`, wymóg PR i zielonego `Quality gate`).
- **Status akceptacji koordynatora (Audyt 2026-10-03 / IC03-S–P)**:
  - Zadania D02.3a/d: Zaakceptowane.
  - Zadania D02.3b/c/e/f: Częściowe / Otwarte (wymagają realizacji korekt IC03-1–5).
  - Stopień zaawansowania roadmapy: 80% (PR #13 w `grela-dev-roadmap`).
  - Usunięto bezwarunkowe roszczenia o "100% zamknięciu", "braku podatności" oraz "całkowitym braku OOM".

---

## 2. Stan prac w podziale na obszary

### Obszar A: Architektura eksportu i współbieżność (IC03-2)
- **Strumieniowanie DOCX**: Zachowano optymalizację w `DocxGenerator` opartą na `OpenXmlWriter`. Zapis wiersz-po-wierszu redukuje retencję obiektów w pamięci względem pełnego drzewa DOM.
- **Konserwatywny semafor współbieżności (3 sloty, no-wait)**:
  - Przywrócono produkcyjny limit **3 równoczesnych slotów** w `ExportRateLimiter` (`maxConcurrency = 3`).
  - Przywrócono natychmiastową odmowę wstępu (`TimeSpan.Zero`) w `Program.cs` – żądania przy zajętych 3 slotach otrzymują natychmiast `HTTP 429 Too Many Requests` (`Retry-After: 1`).
  - Wyeliminowano nieograniczoną czasowo kolejkę oczekujących żądań w pamięci.
- **Pomiary wydajnościowe (`BenchmarkTests`)**:
  - Poprawiono etykiety: `LiveManagedHeapDelta` precyzyjnie opisuje różnicę sterty zarządzanej mierzoną przez `GC.GetTotalMemory`, a nie całkowitą sumę alokacji bajtowych.
  - Próbka Working Set po zakończeniu funkcji została oznaczona jako `ProcessWorkingSetAfterCompletion` (nie jako szczytowy profiler ciągły).
  - Dodano test z trzema odrębnymi zestawami danych o zróżnicowanych kształtach brzegowych (tabela szeroka 50x1k, tabela długa 10x5k, tabela gęsta 25x1k ze zwiększonym tekstem).

### Obszar B: Bezpieczeństwo danych i logowanie (w trakcie realizacji w PR 2)
- Wdrożone: DOM text nodes w `showToast`/`showRateLimitToast`, ochrona przed null w `PayloadValidator.cs`.
- Do poprawy (IC03-1 & IC03-3):
  - Zachowanie nienaruszonego cache w `localStorage` w razie błędu walidacji (zakaz nadpisywania pustym szablonem).
  - Udostępnienie jawnej opcji eksportu ratunkowego (*recovery export*) przed resetem.
  - Usunięcie treści nazw kolumn/kluczy z logów walidacji (zastąpienie kodami błędów i bezpiecznymi wymiarami liczbowymi).

### Obszar C: Procedury operatorskie i testy E2E (w trakcie realizacji w PR 3)
- Do poprawy (IC03-4 & IC03-5):
  - Poprawa poleceń w runbooku operatorskim (`docs/operator-procedures.md`): nazwa wejścia workflow `digest`, nazwane argumenty `--base-url` w `smokecheck.py`, jednoznaczna rezolucja ID kontenera, poprawna domena `tictactoe.grela.dev`, uściślenie pojęć skanera (`ignore-unfixed`) i wskaźników OOM / CPU.
  - Rozszerzenie scenariuszy przeglądarkowych Playwright o rzeczywiste pobieranie plików, obsługę błędów sieciowych, blokadę i odblokowanie przycisku przy kodzie 429.

---

## 3. Plan wdrożenia poprawek (Kolejność PR-ów)

1. **PR 1 (niniejszy)**: `fix/concurrency-and-capacity-measurements` – przywrócenie limitu 3 slotów no-wait, uściślenie nazewnictwa w benchmarkach, aktualizacja README.md i work-status.md.
2. **PR 2**: `fix/data-preservation-and-payload-free-logs` – ochrona cache, eksport ratunkowy, ścisła walidacja typów w JS, logowanie oparte wyłącznie na kodach błędów (bez nazw kolumn).
3. **PR 3**: `fix/acceptance-runbook-and-browser-regressions` – korekta runbooka operatorskiego, rozbudowa testów przeglądarkowych Playwright i regresji Kestrel.

