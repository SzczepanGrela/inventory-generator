# Inventory Generator

*Polish version available at the bottom of the page / Polska wersja na dole strony.*

A modern full-stack web application designed for creating and managing product inventory databases and generating professional reports in **Word (.docx)**, **Excel (.csv)**, and **Webpage (.html)** formats. 

Originally created as a Windows Forms desktop application, this project was redesigned into a **Local-First, Stateless Web Application** to enable server deployment, cross-platform accessibility, and extreme scalability.

---

## Architecture & Technical Stack

```text
┌──────────────────────────────┐       HTTP/REST       ┌─────────────────────────────┐
│    Frontend (Browser SPA)    │  ◄──────────────────► │    Backend (API Server)     │
│                              │                       │                             │
│  • Local Storage (State)     │  POST /api/export     │ • C# ASP.NET Core 8         │
│  • HTML5 / CSS3 (Responsive) │  GET /api/attributes  │ • Stateless Minimal API     │
│  • SaaS Modal-based CRUD     │  GET /api/health      │ • OpenXML SDK 3.5           │
│  • i18n Localization (PL/EN) │                       │ • Rate Limiting & Cost Caps │
│  • Prototype Pollution Guard │                       │ • Strict System.Text.Json   │
│  • WCAG / ARIA Accessible    │                       │ • CSP & Security Headers    │
│  • Full-width Data Table     │                       │ • Non-Root Hardened Docker  │
└──────────────────────────────┘                       └─────────────────────────────┘
```

### Local-First Philosophy
The application state (products, configuration, translations) is fully maintained within your browser's local storage and cookies. The backend acts solely as a high-performance **computation engine** for rendering complex document binaries, ensuring zero server-side data retention and immediate UI responsiveness.

### Security Architecture & Hardening
- **JSON Deserialization Safety (Anti-RCE & Anti-DoS)**:
  - `System.Text.Json` configured with `MaxDepth = 8` and default resolver (no polymorphic deserialization or type-confusion gadgets).
  - Explicit rejection of metadata properties such as `$type`, `__proto__`, `constructor`, `prototype`.
  - Strict scalar-only validation: product cell attributes must be primitive scalar values (string, number, boolean, null); nested objects and arrays are rejected with `400 Bad Request`.
  - Client-side import hardening using null-prototype dictionaries (`Object.create(null)`) to prevent prototype pollution.
- **Request Cost & Resource Limits**:
  - Maximum HTTP request body size capped at 2 MB (`413 Payload Too Large`) enforced before stream materialization.
  - Table dimensions bounded: max 50 columns, max 5,000 rows, max 50,000 cells.
  - Cell string values limited to 1,000 characters; attribute names limited to 100 characters.
- **Rate Limiting & Concurrency**:
  - Partitioned rate limiter using trusted client IP (`X-Forwarded-For` with strict proxy validation).
  - Shared export budget: 10 exports per minute per client with format-specific weighting.
  - DOCX generation burst limit: maximum 2 per burst window.
  - Concurrency limiter semaphore: maximum 3 concurrent document generations to protect single vCPU container performance.
  - Returns `429 Too Many Requests` with standard `Retry-After` header; frontend displays an interactive countdown toast during cooldown.
- **Export Injection Defense**:
  - **CSV Formula Injection**: Leading formula characters (`=`, `+`, `-`, `@`, `\t`, `\r`) are escaped with a single quote prefix while preserving valid negative/positive numbers.
  - **HTML Encoding**: All exported headers and table values are strictly HTML-encoded.
  - **DOCX OpenXML XML 1.0**: Control characters outside the valid XML 1.0 range are stripped, preserving UTF-8 text and custom formatting.
- **Security Headers**:
  - `Content-Security-Policy`: Restricts scripts and framing (`frame-ancestors 'none'`), permits Google Fonts, FontAwesome CDN, and `blob:` / `data:` URI for client-side downloads.
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`

---

## Key Features

1. **Dynamic Schema Customization**: 
   Add, remove, or modify inventory columns (attributes) via an accessible modal dialog. Supported types: Text, Integer, Decimal, Date & Time, Yes/No, Enum.
2. **Internationalization (i18n)**:
   Seamless runtime switching between English and Polish languages, saving user preferences automatically in cookies.
3. **Full-width Interactive Spreadsheet**: 
   Shows all database entries instantly in a mobile-responsive table with adaptive column styling.
4. **Professional Document Exporter**:
   - **Word (.docx)**: Generates a styled table with custom margins, borders, highlighted headers, and adaptive text formatting via OpenXML.
   - **Excel (.csv)**: Generates semicolon-delimited CSV with proper escaping and UTF-8 BOM.
   - **Webpage (.html)**: Generates a clean standalone HTML page with inline responsive table styling.
5. **Project Backup & Restore**:
   Save configuration and data locally as `.json`, and restore it with validation and prototype pollution defense.
6. **Accessibility (WCAG / a11y)**:
   Modals implement ARIA dialog semantics, focus trapping (Tab / Shift+Tab), Escape key dismissal, focus restoration, descriptive button labels, and high-contrast `:focus-visible` outlines.

---

## API Reference (Stateless)

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | `GET` | Health and readiness check returning status and commit revision |
| `/api/attributes/default/{lang}` | `GET` | Fetches the default table layout schema tailored for a language (`en`, `pl`) |
| `/api/export/{format}` | `POST` | Streams generated report (`docx`, `csv`, `html`). Payload must include table state (`Attributes` & `Products`). Protected by body limits, concurrency semaphores, and rate limiting |

---

## Deployment & Release Architecture

Inventory Generator follows the immutable container deployment pattern:
- **Base Image**: Hardened Debian base (`mcr.microsoft.com/dotnet/aspnet:8.0`) with updated system packages and curl probe.
- **Runtime Constraints**: Runs as non-root user (`UID 1654`), with `--cap-drop ALL --init`, memory capped at 512MB (128MB reservation), and 1 CPU.
- **Coolify CD**: Automated deployment through Coolify REST API via `.github/workflows/deploy.yml` and `infra/coolify_release.py`.
- **Artifact Verification**: Deploys only verified, tested, and attested GHCR image digests (`gh attestation verify`).
- **Health-Gated Rollback**: Validates `/api/health` and release smoke checks; automatically cancels failing deployments and restores the previous tested digest.

---

## Getting Started

### Prerequisites
- [.NET 8.0 SDK](https://dotnet.microsoft.com/download)
- [Python 3.10+](https://www.python.org/) (for release automation test suite)

### Run the Application locally
1. Clone this repository:
   ```bash
   git clone https://github.com/SzczepanGrela/inventory-generator.git
   cd inventory-generator
   ```
2. Build and run the project:
   ```bash
   dotnet run --project inventory-generator.csproj
   ```
3. Open your browser and navigate to `http://localhost:8080` (or configured port).

### Testing
To run the automated .NET test suites (58 Unit & Integration tests):
```bash
dotnet test inventory-generator.sln
```

To run the Coolify CD release automation test suite (17 Python tests):
```bash
python3 -m unittest discover -s tests -v
```

---

## License
This project is licensed under the [MIT License](LICENSE).

---

<details>
<summary><b>Polska wersja (Polish version)</b></summary>
<br>

# Inventory Generator

Nowoczesna aplikacja webowa full-stack zaprojektowana do tworzenia i zarządzania bazami inwentaryzacyjnymi produktów oraz generowania profesjonalnych raportów w formatach **Word (.docx)**, **Excel (.csv)** i **Strony WWW (.html)**.

Początkowo stworzona jako aplikacja pulpitowa Windows Forms, projekt ten został całkowicie przeprojektowany na **bezstanową aplikację webową (Local-First)**, by umożliwić wdrażanie na serwerach, dostęp międzyplatformowy i maksymalną skalowalność.

---

## Architektura i Stos Technologiczny

```text
┌──────────────────────────────┐       HTTP/REST       ┌─────────────────────────────┐
│    Frontend (Browser SPA)    │  ◄──────────────────► │    Backend (API Server)     │
│                              │                       │                             │
│  • Local Storage (State)     │  POST /api/export     │ • C# ASP.NET Core 8         │
│  • HTML5 / CSS3 (Responsywny)│  GET /api/attributes  │ • Stateless Minimal API     │
│  • SaaS Modal-based CRUD     │  GET /api/health      │ • OpenXML SDK 3.5           │
│  • i18n Lokalizacja (PL/EN)  │                       │ • Limity zasobów i zapytań  │
│  • Ochrona Prototype Pollut. │                       │ • Ścisły System.Text.Json   │
│  • Dostępność WCAG / ARIA    │                       │ • Nagłówki CSP i nosniff    │
│  • Pełnoekranowa Tabela Danych│                      │ • Bezpieczny Docker non-root│
└──────────────────────────────┘                       └─────────────────────────────┘
```

### Filozofia Local-First
Stan aplikacji (produkty, konfiguracja, tłumaczenia) jest w pełni utrzymywany w obrębie lokalnego magazynu (local storage) przeglądarki oraz w ciasteczkach. Backend działa wyłącznie jako wysokowydajny **silnik obliczeniowy** służący do renderowania złożonych plików binarnych dokumentów, co gwarantuje brak jakiegokolwiek przetrzymywania danych po stronie serwera i natychmiastową reakcję interfejsu użytkownika.

### Architektura Bezpieczeństwa i Ochrona Zasobów
- **Bezpieczeństwo Deserializacji JSON (Anti-RCE & Anti-DoS)**:
  - `System.Text.Json` skonfigurowany z `MaxDepth = 8` oraz domyślnym resolverem typów (brak polimorficznej deserializacji zapobiega atakom typu Type Confusion / Deserialization Gadgets).
  - Jawne odrzucanie metadanych typów (`$type`) oraz kluczy prototypów (`__proto__`, `constructor`, `prototype`).
  - Rygorystyczna walidacja skalarności: wartości w komórkach produktów mogą być wyłącznie typami pierwotnymi (string, number, boolean, null); zagnieżdżone obiekty lub tablice są odrzucane z kodem `400 Bad Request`.
  - Zabezpieczenie importu po stronie przeglądarki przy użyciu słowników z pustym prototypem (`Object.create(null)`).
- **Limity Rozmiaru Żądań i Danych**:
  - Maksymalny rozmiar body HTTP ograniczony do 2 MB (`413 Payload Too Large`), egzekwowany w Kestrel/middleware przed serializacją w pamięci.
  - Limity wymiarów tabeli: max 50 kolumn, max 5 000 wierszy, max 50 000 komórek.
  - Limit długości wartości tekstowej komórki: 1 000 znaków; limit nazwy atrybutu: 100 znaków.
- **Wielopoziomowy Rate Limiting i Współbieżność**:
  - Partycjonowanie po zaufanym adresie IP klienta (`X-Forwarded-For` z weryfikacją znanych proxy).
  - Wspólny budżet eksportów: 10 generacji na minutę per klient ze współdzielonym licznikiem formatów.
  - Limit burst dla DOCX: maksymalnie 2 generacje w oknie krótkim.
  - Semafor współbieżności: maksymalnie 3 równoczesne generacje dokumentów chroniące 1 rdzeń vCPU na serwerze.
  - Odpowiedź `429 Too Many Requests` z nagłówkiem `Retry-After`; interfejs użytkownika prezentuje czytelny toast z odliczaniem czasu.
- **Zabezpieczenie Generowanych Formatów**:
  - **CSV Formula Injection**: Znaki formuł kalkulacyjnych (`=`, `+`, `-`, `@`, `\t`, `\r`) na początku komórki są neutralizowane pojedynczym apostrofem, z zachowaniem poprawności liczb ujemnych i dodatnich.
  - **HTML Encoding**: Wszystkie nagłówki i wartości są ściśle eskejpowane funkcją `WebUtility.HtmlEncode`.
  - **DOCX OpenXML XML 1.0**: Znaki kontrolne spoza specyfikacji XML 1.0 są usuwane, co zapobiega uszkodzeniu plików docx.
- **Nagłówki Bezpieczeństwa Przeglądarki**:
  - `Content-Security-Policy`: Blokuje nieautoryzowane skrypty i osadzanie w ramkach (`frame-ancestors 'none'`), zezwala na Google Fonts, FontAwesome CDN oraz pobieranie plików `blob:`.
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`

---

## Kluczowe Funkcje

1. **Dynamiczna Personalizacja Schematu**: 
   Dodawaj, usuwaj lub modyfikuj kolumny inwentarza bezpośrednio z dostępnego modalu. Obsługiwane typy: Tekst, Liczba całkowita, Ułamek, Data i Czas, Tak/Nie, Lista wyboru.
2. **Internacjonalizacja (i18n)**:
   Płynne przełączanie w czasie rzeczywistym między językiem polskim i angielskim, z zachowaniem preferencji w ciasteczkach.
3. **Pełnoekranowa Interaktywna Tabela**: 
   Wyświetla błyskawicznie wszystkie pozycje w responsywnym układzie.
4. **Profesjonalny Eksporter Dokumentów**:
   - **Word (.docx)**: Generuje tabelę ze stylami, marginesami, nagłówkami i adaptacyjnym formatowaniem tekstu.
   - **Excel (.csv)**: Generuje CSV ze średnikami, poprawnym eskejpowaniem i UTF-8 BOM.
   - **Strona WWW (.html)**: Generuje estetyczną, kompletną stronę HTML.
5. **Kopia Zapasowa i Przywracanie**:
   Zapisz konfigurację i dane lokalnie jako `.json` z walidacją struktury i ochroną przed Prototype Pollution.
6. **Dostępność (WCAG / a11y)**:
   Modale oparte na semantyce dialogu ARIA, z pułapką fokusu (Tab / Shift+Tab), zamykaniem klawiszem Escape, przywracaniem fokusu, czytelnymi etykietami `aria-label` oraz obramowaniem `:focus-visible`.

---

## Dokumentacja API (Bezstanowe)

| Endpoint | Metoda | Opis |
|---|---|---|
| `/api/health` | `GET` | Endpoint badania stanu zdrowia aplikacji zwracający status i rewizję commita |
| `/api/attributes/default/{lang}` | `GET` | Pobiera domyślny schemat tabeli dla danego języka (`en`, `pl`) |
| `/api/export/{format}` | `POST` | Eksportuje wygenerowany raport (`docx`, `csv`, `html`). Chroniony limitami body (2MB), limitami współbieżności i budżetem eksportów |

---

## Architektura Wdrażania i Wydania

Aplikacja wdrażana jest według wzorca niezmiennego kontenera (immutable container):
- **Obraz bazowy**: Zabezpieczony Debian (`mcr.microsoft.com/dotnet/aspnet:8.0`) z zaktualizowanymi pakietami i sondą curl.
- **Ograniczenia środowiska**: Kontener uruchamiany jako non-root (`UID 1654`), z opcjami `--cap-drop ALL --init`, limitem pamięci 512MB (rezerwacja 128MB) oraz 1 vCPU.
- **Coolify CD**: Automatyzacja wydania przez prywatne API Coolify za pośrednictwem workflow `.github/workflows/deploy.yml` i skryptu `infra/coolify_release.py`.
- **Weryfikacja poświadczeń**: Wdrażane są wyłącznie poświadczone i przetestowane digesty z GHCR (`gh attestation verify`).
- **Wycofanie sterowane testami zdrowia (Rollback)**: Weryfikacja `/api/health` oraz sondy dymnej; automatyczne anulowanie i natychmiastowe przywrócenie poprzedniego działającego digestu w razie błędu.

---

## Uruchamianie i Testowanie

### Wymagania
- [.NET 8.0 SDK](https://dotnet.microsoft.com/download)
- [Python 3.10+](https://www.python.org/) (do testów automatyzacji wydania)

### Uruchamianie lokalne
1. Sklonuj repozytorium:
   ```bash
   git clone https://github.com/SzczepanGrela/inventory-generator.git
   cd inventory-generator
   ```
2. Zbuduj i uruchom projekt:
   ```bash
   dotnet run --project inventory-generator.csproj
   ```
3. Otwórz przeglądarkę pod adresem `http://localhost:8080`.

### Testowanie
Uruchomienie testów .NET (58 testów jednostkowych i integracyjnych):
```bash
dotnet test inventory-generator.sln
```

Uruchomienie testów automatyzacji wydania Coolify (17 testów Python):
```bash
python3 -m unittest discover -s tests -v
```

---

## Licencja
Projekt ten objęty jest licencją [MIT License](LICENSE).

</details>
