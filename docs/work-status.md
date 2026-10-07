# Status prac Inventory Generator (Work Status)

## 1. Rozgraniczenie Środowisk i Statusów (Separation of Boundaries)

Dla zachowania pełnej przejrzystości operacyjnej wprowadza się ścisłe rozróżnienie pomiędzy stanem kodu, testów, środowiska produkcyjnego oraz formalnej akceptacji:

- **Zaimplementowane w kodzie źródłowym**:
  - Rewizja bazowa `main`: `16ed383d2affb96a7a538ec935a7b3b7dd337257` (scalone PR #23, #24, #25).
  - PR #26: `fix/preserve-cache-throughout-recovery` (head: `fdeadde`) – pojedynczy autorytatywny zapis projektu (`inventory_project`, wersjonowana koperta `{ version: 1, attributes, products }`) jako wyłączny punkt zatwierdzenia z bezpieczną migracją kluczy legacy, brak usuwania ani nadpisywania trwałego oryginału przed zatwierdzeniem nowego projektu, brak fałszywych toastów sukcesu, zachowanie stanu awaryjnego i pełnego oryginału (zarówno atrybutów, jak i 5001 wierszy) w kopii recovery po przeładowaniu, dołączenie dokładnego surowego stringu autorytatywnego projektu do eksportu recovery niezależnie od poprawności JSON (IC07-1), dwujęzyczny modal i etykiety accessibility (PL/EN).
  - PR #27: `fix/operator-runbook-selectors-and-rollback` – wspierana ścieżka manualnego rollbacku w GitHub Actions (rozróżnienie intencjonalnego `workflow_dispatch` od automatycznej bramki świeżości `workflow_call` i `push`), zamrożenie promocyjne (*promotional freeze*) zamiast nieuzasadnionego powoływania się na lock ze snapshotu API, poprawna kolejność obsługi wyjątku `UncertainDeployment` przed `ReleaseError` powiązana bezpośrednio z rzeczywistym przykładem Python w runbooku za pomocą AST i wykonania (IC07-2), tablica selektorów kontenerów w bashu (`--filter id=...`), realistyczne budżety czasowe (CoolifyClient: 15s timeout, do 3 prób GET z backoffem 1s i 2s; 60s–210s dla pętli monitorowania), 34 testy offline Pythona powiązane bezpośrednio z rzeczywistymi blokami źródłowymi.
  - **Ważne**: Obie gałęzie bazują niezależnie na `main` (`16ed383d`); **PR #27 nie zawiera zmian z PR #26**. Testy i CI obu PR-ów są rozłączne; połączony kandydat będzie wymagał wspólnego zielonego CI po standardowej integracji w `main`.
- **Przetestowane w CI**:
  - Dla PR #26: 84 testy .NET Core, 17 testów Pythona, 12 zestawów testów E2E Playwright (w tym subtesty 7F-7J weryfikujące błędy zapisu, trwałość oryginału po przeładowaniu, brak mutacji magazynu i zrzut surowego projektu oraz dwujęzyczność).
  - Dla PR #27: 84 testy .NET Core, 34 testy Pythona (w tym testy offline kontraktu, odporności na niepewne wdrożenia, bramki świeżości workflow deploy powiązane z rzeczywistym `deploy.yml`, weryfikacji etykiet rewizji obrazu, kolejności wyjątków powiązanej z `operator-procedures.md` i selektorów kontenerów) oraz testy przeglądarkowe w zakresie gałęzi bazowej.
- **Wdrożone na produkcję (Live VPS)**:
  - Commit SHA: `9a2dee631f4aff76dc2024d3036287ad93216452` (PR #18, .NET 10 LTS).
  - Publiczny punkt kontrolny: `https://inventory-generator.grela.dev` (odczyt publiczny potwierdza wersję `9a2dee6...`).
  - **Żadne późniejsze zmiany z gałęzi `main` (w tym PR #23, #24, #25, #26, #27) nie zostały wdrożone na serwer produkcyjny VPS**. Wdrożenie produkcyjne pozostaje celowo niewykonane i niezatwierdzone w GitHub Actions do czasu ukończenia procedury odbioru.
- **Formalny status odbioru koordynatora (Audyt 2026-10-07 / IC07, PR #53 w grela-dev-infrastructure)**:
  - Zadanie **D02.3a** (zakres źródeł/metadanych, spójność SDK/.NET runtime/Actions/obrazu bazowego oraz powiązane PR-y zależności; definicja kanoniczna w [roadmapie grela-dev-roadmap](https://github.com/SzczepanGrela/grela-dev-roadmap/pull/13)) pozostaje **otwarte / niezamknięte** (*unchecked*).
  - Zadanie **D02.3d** rejestruje zakres implementacji dostawy (*delivery implementation*) i dowody normalnego wydania w Coolify, a nie pełną izolację wykonawczą (*runtime isolation*).
  - Zadania **D02.3b, D02.3c, D02.3e, D02.3f** pozostają **otwarte / w toku**:
    - D02.3c & D02.3f: Zaadresowane w otwartych do review PR #26 (IC07-1) i PR #27 (IC07-2).
    - D02.3b: Wymaga kwalifikacji obciążenia DOCX/CSV/HTML pod limitami 1 CPU / 512 MiB w skoordynowanym oknie (3 sloty no-wait nie stanowią bezwarunkowego dowodu wyeliminowania OOM).
    - D02.3e: Testy awaryjne/rollbacku na żywym VPS wymagają odrębnego okna operacyjnego z progami zatrzymania.
  - Oficjalny status śledzony jest bezpośrednio w dokumentacji koordynatora: audyty `audits/2026-10-07-inventory-candidate-review.md` (w `grela-dev-infrastructure` PR #53) oraz roadmapa (w `grela-dev-roadmap` PR #13, 84%). Zielone CI samo w sobie nie zamyka D02.3.

---

## 2. Szczegółowy stan prac w obszarach zadaniowych

### Obszar A: Architektura eksportu i współbieżność (IC03-2) - [Scalono w PR #23]
- **Buforowane generowanie DOCX**: `DocxGenerator` oparty na `OpenXmlWriter` zapisuje elementy XML do buforowanego pakietu dokumentu w pamięci (`MemoryStream`), redukując retencję obiektów w pamięci względem pełnego drzewa DOM modelu OpenXML. Gotowy bufor jest następnie zwracany jako tablica bajtów w odpowiedzi HTTP (nie jest to bezpośrednie strumieniowanie wierszy do sieciowego strumienia odpowiedzi HTTP).
- **Konserwatywny semafor współbieżności (3 sloty, no-wait)**:
  - Limit 3 równoległych operacji eksportu dla wszystkich formatów (DOCX, CSV, HTML) w `ExportRateLimiter`.
  - Natychmiastowe odrzucenie nadmiarowych żądań z kodem `HTTP 429 Too Many Requests` (`Retry-After: 1`, brak nieograniczonej kolejki FIFO w pamięci).
- **Rzetelne pomiary wydajnościowe (`BenchmarkTests`)**:
  - `LiveManagedHeapDelta` precyzyjnie opisuje zmianę rozmiaru sterty zarządzanej raportowaną przez `GC.GetTotalMemory`, a nie całkowitą sumę alokacji.
  - Pomiar Working Set oznaczony jako `ProcessWorkingSetAfterCompletion` (wskazuje stan po zakończeniu, nie szczytowy profiler ciągły).
  - Trzy zróżnicowane syntetyczne kształty tabel (szeroka 50x1k, długa 10x5k, gęsta 25x1k).

### Obszar B: Integralność danych i bezpieczne logowanie (IC03-1, IC03-3, IC04-1, IC05-1, IC05F-1) - [Scalono w PR #24, poprawki w PR #26]
- **Trwała ochrona lokalnego projektu**:
  - Pojedynczy autorytatywny zapis projektu (`persistProject` zapisujący wersjonowaną kopertę `inventory_project`), eliminujący zawodne próby kompensacji dwufazowej; w razie niepowodzenia zapisu magazyn `localStorage` pozostaje nienaruszony (dane legacy zachowane).
  - `resetCorruptedCacheToDefault` oraz `importProjectFromJson` czyszczą stan recovery i wyświetlają toast sukcesu dopiero po trwałym zatwierdzeniu projektu w magazynie przeglądarki.
  - Zachowanie stanu recovery i pełnego oryginału (zarówno atrybutów, jak i 5001 wierszy) w magazynie i po przeładowaniu strony.
  - Pełna dwujęzyczność okna recovery i etykiet ARIA (PL/EN).
- **Logi serwerowe bez danych użytkownika (`Program.cs`, `PayloadValidator.cs`)**:
  - Ustrukturyzowane kody błędów (`ValidationOutcome`) – logowane wyłącznie metadane (`ClientIp`, `Format`, `ErrorCode`, `ColumnsCount`, `RowsCount`). Żadna nazwa kolumny użytkownika ani klucz atrybutu nie trafia do logów.

### Obszar C: Procedury operatorskie i testy integracyjne (IC03-4, IC03-5, IC04-2, IC05-2..4, IC05F-2) - [Scalono w PR #25, poprawki w PR #27]
- **Wykonywalny runbook operatorski (`docs/operator-procedures.md`)**:
  - Selektor kontenera: numeryczny database ID (`APP_NUMERIC_ID`) z Coolify API lub unikalny prefiks nazwy kontenera dla danego UUID; dla wielu kontenerów tablica argumentów `FILTER_ARGS+=(--filter "id=$cid")`.
  - Manualny rollback w GitHub Actions: wspierana ścieżka `workflow_dispatch` z weryfikacją etykiety obrazu i ochroną przed pominięciem przez bramkę świeżości.
  - Awaryjny rollback w Coolify: wymóg skoordynowanego zamrożenia promocji (*promotional freeze*) na czas operacji; obsługa `UncertainDeployment` przed `ReleaseError`.
  - Rzetelne budżety czasowe: `CoolifyClient` stosuje domyślnie 15-sekundowy timeout pojedynczego wywołania oraz do 3 prób GET (z retry backoff 1s, 2s; natychmiastowy powrót przy sukcesie); pętla monitorowania sąsiada w runbooku (od min. 60s do maks. ~210s).
- **Rozszerzone testy offline**:
  - Regresja Kestrel chunked body HTTP 413 dla zapytań > 2 MiB.
  - 34 testy Pythona powiązane bezpośrednio z rzeczywistym kodem źródłowym (ekstrakcja bloków shellowych z `.github/workflows/deploy.yml` dla bramki świeżości `push`/`workflow_call`/`workflow_dispatch` oraz weryfikacji etykiet obrazu; ekstrakcja selektora kontenerów z `docs/operator-procedures.md` dla 0/1/2 ID; kontrakt, odrzucanie wdrożeń przy konfliktach, niepewne statusy, kolejność wyjątków).

---

## 3. Zestawienie Otwartej Ścieżki Wydania (Open PRs)

Zgodnie z wytycznymi koordynatora, oba PR-y pozostają otwarte do przeglądu i nie są scalane przed autoryzacją:

1. **PR #26 (Ochrona Cache w Całym Cyklu Recovery)**:
   - Branch: `fix/preserve-cache-throughout-recovery`
   - Head: `b3d6fb3`
   - Status: Otwarty, zielone CI.
2. **PR #27 (Wykonywalne Procedury Operatorskie i Bezpieczny Rollback)**:
   - Branch: `fix/operator-runbook-selectors-and-rollback`
   - Head: [aktualizowany w bieżącym commicie]
   - Status: Otwarty do przeglądu koordynatora.
