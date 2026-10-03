# Status prac Inventory Generator (Work Status)

## Aktualny stan (Checkpoint)

- **Repozytorium**: `SzczepanGrela/inventory-generator`
- **Gałąź**: `fix/security-null-safety-and-validation`
- **Rewizja bazowa**: `005dc2534c44e311e1f24690794e60e7d452cb27` (PR #19, .NET 10 LTS)
- **Produkcja**: `https://inventory-generator.grela.dev` pod rewizją `005dc2534c44e311e1f24690794e60e7d452cb27` (.NET 10 LTS, zdrowa, testy dymne 200 OK)
- **Status reguł branch protection**: Na gałęzi `main` obowiązuje ruleset `#24407679` (wymóg PR, brak direct push, wymagany zielony `Quality gate`).

---

## Zakres wdrożonych poprawek (Closeout)

### 1. Bezpieczeństwo frontendowe (HTML Sinks) i walidacja Local-First:
- **Eliminacja podatności na HTML injection w `wwwroot/js/app.js`**:
  - Przepisano `showToast` i `showRateLimitToast` – zastąpiono niebezpieczne `innerHTML` bezpiecznymi węzłami DOM (`createElement` + `textContent`). Wszelkie złośliwe tagi HTML są renderowane jako czysty tekst.
  - Zabezpieczono renderowanie w `renderAttributesSettings` (`badge` oraz znaczniki stylów kolumn renderowane przez DOM zamiast interpolacji HTML).
- **Ścisła walidacja i odporność cache w `sanitizeProjectData` i `loadLocalData`**:
  - `sanitizeProjectData`: Odrzucanie obiektów null/niebędących obiektami w definicjach kolumn i produktach, wymóg istnienia co najmniej jednej poprawnej kolumny (`cleanAttributes.length >= 1`), ścisła weryfikacja wartości typu Enum oraz ograniczenie szerokości kolumn (od 200 do 4000).
  - `loadLocalData`: Pełna sanityzacja danych wczytywanych z `localStorage` przy starcie. W przypadku wykrycia uszkodzonego stanu (malformed JSON lub niepoprawna struktura kolumn) aplikacja nie zawiesza się, lecz wyświetla czytelny toast ostrzegawczy (`toast_cache_corrupted`) i bezpiecznie przywraca domyślny szablon kolumn.
  - Przy imporcie JSON: W razie błędu pliku wejściowego poprzedni stan danych w aplikacji i `localStorage` pozostaje nienaruszony.

### 2. Backend Null-Safety, walidacja i limity Kestrel:
- **Eliminacja ryzyka HTTP 500 / `NullReferenceException` w `Services/PayloadValidator.cs`**:
  - Obsłużono przypadki `null` elementów w tablicy `Attributes` (np. `{"attributes": [null]}`) oraz `Products`.
  - Obsłużono walidację poprawności `attr.Type` z `Enum.IsDefined(typeof(AttributeType), attr.Type)`.
  - Dodano walidację zakresu szerokości kolumny `attr.ColumnWidth` (50–5000).
  - Dodano walidację wartości Enum (co najmniej jedna niepusta wartość dla kolumn Enum).
  - Dodano walidację kluczy słowników produktów (zakaz pustych lub whitespace kluczy) oraz ochronę przed wartościami `NaN` i `Infinity` dla liczb zmiennoprzecinkowych.
  - Wszystkie powyższe błędy zwracają precyzyjny kod HTTP 400 Bad Request z opisem.
- **Obsługa strumieniowanego limitu 2 MB Kestrel (`Program.cs`)**:
  - Dodano middleware przechwytujący `BadHttpRequestException` z kodem 413, generujący spójną odpowiedź JSON dla żądań przekraczających 2 MB bez nagłówka `Content-Length` (chunked transfer).
- **Ustrukturyzowane logowanie (`Program.cs`)**:
  - Dodano `LogWarning` dla odrzuceń walidacji (`validationError`), przekroczeń limitu tokenów rate limitera (ze wskazaniem `RetryAfter`) oraz wyczerpania slotów współbieżności.
  - Dodano `LogInformation` z metrykami wykonania po każdym udanym eksporcie (`Format`, `ClientIp`, `DurationMs`, `Rows`, `Columns`, `OutputBytes`), bez logowania wrażliwej zawartości dokumentów.

### 3. Pomiary wydajności i kosztów (Maksymalna pojemność 50 000 komórek):
Przeprowadzono precyzyjny benchmark lokalny generatorów dla maksymalnego limitu (50 kolumn x 1 000 wierszy):
- **CSV**: czas ~4 ms, rozmiar pliku wyjściowego 380.8 KB, alokacja RAM: ~3.9 MB
- **HTML**: czas ~18 ms, rozmiar pliku wyjściowego 1.93 MB, alokacja RAM: ~14.6 MB
- **DOCX**: czas ~767 ms, rozmiar pliku wyjściowego 107.3 KB, alokacja RAM: ~127.6 MB

**Wnioski architektoniczne**: Pomiary w pełni uzasadniają model jednostek kosztu (DOCX = 2 jednostki kosztu + bucket burst + max 3 sloty współbieżności), chroniący kontener 512 MB RAM / 1 vCPU przed wyczerpaniem pamięci OOM.

### 4. Aktualizacja dokumentacji (`README.md`):
- Zaktualizowano opis limitów: zastąpiono uproszczone „10 generacji/min” modelem **ważonych jednostek kosztu** (*cost units*).
- Zaktualizowano wszystkie odniesienia architektoniczne do środowiska **.NET 10 LTS** (usunięto wzmianki o .NET 8).
- Dodano zestawienie pomiarów wydajnościowych worst-case.
- Zaktualizowano instrukcje uruchamiania testów o pakiet Playwright.

---

## Wyniki testów automatycznych

1. **Testy jednostkowe i integracyjne .NET** (`dotnet test inventory-generator.sln --configuration Release`):
   - `inventory-generator.UnitTests`: **56/56 zaliczonych** (w tym `PayloadValidatorTests` i `BenchmarkTests`)
   - `inventory-generator.IntegrationTests`: **22/22 zaliczonych** (w tym 10 nowych testów `NullSafetyTests`: `[null]` w attributes, `[null]` w products, null attributes dictionary, niepoprawny enum, szerokość kolumny, pusty klucz, chunked stream > 2 MB zwracający 413)
   - Łącznie: **78 testów .NET – 100% PASS**

2. **Testy przeglądarkowe Playwright E2E** (`npm test --prefix tests/browser`):
   - Test 1: Inicjalizacja, ładowanie szablonu i trwałość Local-First w `localStorage` across reloads – **PASS**
   - Test 2: Ochrona przed HTML Injection / XSS w toastach – **PASS**
   - Test 3: Wykrywanie i bezpieczne odzyskiwanie uszkodzonego cache – **PASS**
   - Test 4: Dostępność modali (a11y), pułapka fokusu i zamykanie klawiszem `Escape` – **PASS**
   - Test 5: Płynne przełączanie języków PL / EN – **PASS**
   - Test 6: Odliczanie sekund w toascie limitu 429 i blokada przycisku pobierania – **PASS**
   - Łącznie: **6/6 testów E2E – 100% PASS**

3. **Testy automatyzacji wydania Coolify** (`python3 -m unittest discover -s tests -v`):
   - **17/17 zaliczonych – 100% PASS**

---

## Kolejne kroki

1. Utworzenie Pull Requesta na GitHubie dla gałęzi `fix/security-null-safety-and-validation`.
2. Weryfikacja przejścia GitHub Actions (`Quality gate` z rulesetu `#24407679`).
3. Przegląd i obsługa zaległych PR Dependabota (#17 i #18).
