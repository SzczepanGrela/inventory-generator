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
│  • SaaS Modal-based CRUD     │                       │ • OpenXML SDK 3.5           │
│  • i18n Localization (PL/EN) │                       │ • Rate Limiting Middleware  │
│  • Full-width Data Table     │                       │ • Docker Containerized      │
└──────────────────────────────┘                       └─────────────────────────────┘
```

### Local-First Philosophy
The application state (products, configuration, translations) is fully maintained within your browser's local storage and cookies. The backend acts solely as a high-performance **computation engine** for rendering complex document binaries, ensuring zero server-side data retention and immediate UI responsiveness.

### Backend Stack
- **C# / .NET 8.0 SDK** using Minimal APIs.
- **xUnit Test Architecture** for Unit and Integration tests (`WebApplicationFactory`).
- **DocumentFormat.OpenXml (OpenXML SDK 3.5.1)** for generating high-fidelity native Microsoft Word (.docx) files.

---

## Key Features

1. **Dynamic Schema Customization**: 
   Add, remove, or modify inventory columns (attributes) via a dedicated Modal interface. Supported data types: Text, Integer, Decimal, Date & Time, Yes/No, Enum.
2. **Internationalization (i18n)**:
   Seamless runtime switching between English and Polish languages, saving user preferences automatically in cookies.
3. **Full-width Interactive Spreadsheet**: 
   Shows all database entries instantly in a mobile-responsive table. Columns adapt to settings (e.g., right-aligning numbers, bolding specific columns, etc.).
4. **Professional Document Exporter**:
   - **Word (.docx)**: Generates a styled table with custom margins, gray borders, blue highlighted headers, and adaptive text formatting matching C# models.
   - **Excel (.csv)**: Generates a CSV file using semicolon delimiters, fully escaped strings, and a UTF-8 BOM.
   - **Webpage (.html)**: Generates a clean standalone HTML page with inline responsive table styling.
5. **Project Backup & Restore**: Save your entire configuration and data locally as an ordinary `.json` file, and upload it back to restore the full project state.

---

## API Reference (Stateless)

| Endpoint | Method | Description |
|---|---|---|
| `/api/attributes/default/{lang}` | `GET` | Fetches the default table layout schema tailored for a specific language (`en`, `pl`) |
| `/api/export/{format}` | `POST` | Streams generated report (`docx`, `csv`, `html`). Payload must include full application state (`Attributes` & `Products`). Protected by Rate Limiting |

---

## Getting Started

### Prerequisites
- [.NET 8.0 SDK](https://dotnet.microsoft.com/download)

### Run the Application locally
1. Clone this repository:
   ```bash
   git clone https://github.com/SzczepanGrela/inventory-generator.git
   cd inventory-generator
   ```
2. Build and run the project via Solution:
   ```bash
   dotnet run --project inventory-generator.csproj
   ```
3. Open your browser and navigate to `http://localhost:5000`

### Testing
To run the automated test suite (Unit and Integration tests):
```bash
dotnet test inventory-generator.sln
```

---

## DevOps & CI/CD
This project features a fully automated CI/CD pipeline using **GitHub Actions**. Upon every push to the `main` branch:
1. Validates the .NET Code using `dotnet build`.
2. Runs the full test suite `dotnet test`.
3. Triggers a remote deployment over a secure **Tailscale VPN** utilizing `infra/deploy.sh` to update the application running on a VPS in an NGINX Proxy Manager network.

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
│  • SaaS Modal-based CRUD     │                       │ • OpenXML SDK 3.5           │
│  • i18n Lokalizacja (PL/EN)  │                       │ • Rate Limiting Middleware  │
│  • Pełnoekranowa Tabela Danych│                      │ • Konteneryzacja Docker     │
└──────────────────────────────┘                       └─────────────────────────────┘
```

### Filozofia Local-First
Stan aplikacji (produkty, konfiguracja, tłumaczenia) jest w pełni utrzymywany w obrębie lokalnego magazynu (local storage) przeglądarki oraz w ciasteczkach. Backend działa wyłącznie jako wysokowydajny **silnik obliczeniowy** służący do renderowania złożonych plików binarnych dokumentów, co gwarantuje brak jakiegokolwiek przetrzymywania danych po stronie serwera i natychmiastową reakcję interfejsu użytkownika.

### Stos Backendu
- **C# / .NET 8.0 SDK** z wykorzystaniem architektury Minimal API.
- **Architektura Testowa xUnit** dla testów jednostkowych i integracyjnych (`WebApplicationFactory`).
- **DocumentFormat.OpenXml (OpenXML SDK 3.5.1)** do generowania natywnych plików Microsoft Word (.docx).

---

## Kluczowe Funkcje

1. **Dynamiczna Personalizacja Schematu**: 
   Dodawaj, usuwaj lub modyfikuj kolumny inwentarza (atrybuty) bezpośrednio z dedykowanego okna Modal. Obsługiwane typy danych to: Tekst, Liczba całkowita, Ułamek, Data i Czas, Tak/Nie, Lista wyboru.
2. **Internacjonalizacja (i18n)**:
   Płynne przełączanie w czasie rzeczywistym między językiem polskim i angielskim, z zachowaniem preferencji użytkownika w ciasteczkach.
3. **Pełnoekranowa Interaktywna Tabela**: 
   Wyświetla błyskawicznie wszystkie pozycje w responsywnym układzie (mobile-ready). Kolumny dostosowują się do ustawień (np. wyrównywanie do prawej, pogrubianie itp.).
4. **Profesjonalny Eksporter Dokumentów**:
   - **Word (.docx)**: Generuje oskryptowaną tabelę z odpowiednimi marginesami, szarymi obramowaniami, podświetlonymi na niebiesko nagłówkami i adaptacyjnym formatowaniem tekstu zgrywającym się z definicjami modelu C#.
   - **Excel (.csv)**: Generuje zoptymalizowany plik CSV ze znacznikami średnika, poprawionymi cudzysłowami i znacznikiem UTF-8 BOM.
   - **Strona WWW (.html)**: Generuje estetyczną, gotową stronę HTML do wyświetlenia.
5. **Kopia Zapasowa i Przywracanie**: Zapisz całą swoją konfigurację i dane lokalnie jako zwykły plik `.json`, a następnie wgraj go z powrotem, aby w 100% przywrócić projekt.

---

## Dokumentacja API (Bezstanowe)

| Endpoint | Metoda | Opis |
|---|---|---|
| `/api/attributes/default/{lang}` | `GET` | Pobiera domyślny schemat ułożenia tabeli przeznaczony dla konkretnego języka (`en`, `pl`) |
| `/api/export/{format}` | `POST` | Eksportuje wygenerowany raport (`docx`, `csv`, `html`). Payload przesyłany z przeglądarki musi posiadać pełny stan (`Attributes` i `Products`). Zabezpieczone limitami zapytań (Rate Limiting) |

---

## Wdrażanie i Uruchamianie

### Wymagania
- [.NET 8.0 SDK](https://dotnet.microsoft.com/download)

### Uruchamianie aplikacji lokalnie
1. Sklonuj niniejsze repozytorium:
   ```bash
   git clone https://github.com/SzczepanGrela/inventory-generator.git
   cd inventory-generator
   ```
2. Zbuduj i odpal projekt przy użyciu Solucji:
   ```bash
   dotnet run --project inventory-generator.csproj
   ```
3. Otwórz swoją przeglądarkę pod adresem `http://localhost:5000`

### Testowanie
Aby uruchomić zestaw zautomatyzowanych testów (Unit oraz Integration tests):
```bash
dotnet test inventory-generator.sln
```

---

## DevOps i CI/CD
Ten projekt zawiera w pełni zautomatyzowany łańcuch wdrożeń (pipeline) przy użyciu **GitHub Actions**. Przy każdym przesłaniu zmian na gałąź `main`:
1. Weryfikuje kod .NET przy użyciu polecenia `dotnet build`.
2. Odtwarza całą warstwę testów `dotnet test`.
3. Aktywuje proces zdalnego wdrożenia poprzez bezpieczny tunel VPN w **Tailscale**, wykorzystując skrypt `infra/deploy.sh` w celu zaaktualizowania aplikacji na serwerze (VPS), przypinając go w sieci NGINX Proxy Manager.

## Licencja
Projekt ten objęty jest licencją [MIT License](LICENSE).

</details>
