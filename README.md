# Inventory Generator

A modern full-stack web application designed for creating and managing product inventory databases and generating professional reports in **Word (.docx)**, **Excel (.csv)**, and **Webpage (.html)** formats. 

Originally created as a Windows Forms desktop application, this project was redesigned into a **Local-First, Stateless Web Application** to enable server deployment, cross-platform accessibility, and extreme scalability.

---

## 🚀 Architecture & Technical Stack

```text
┌──────────────────────────────┐       HTTP/REST       ┌─────────────────────────────┐
│    Frontend (Browser SPA)    │  ◄──────────────────► │    Backend (API Server)     │
│                              │                       │                             │
│  • Local Storage (State)     │  POST /api/export     │ • C# ASP.NET Core 8         │
│  • HTML5 / CSS3 (Vanilla)    │  GET /api/attributes  │ • Stateless Minimal API     │
│  • i18n Localization (PL/EN) │                       │ • OpenXML SDK 3.5           │
│  • Dynamic Form rendering    │                       │ • Rate Limiting Middleware  │
│  • Live Spreadsheet Table    │                       │ • Docker Containerized      │
└──────────────────────────────┘                       └─────────────────────────────┘
```

### Local-First Philosophy
The application state (products, configuration, translations) is fully maintained within your browser's local storage and cookies. The backend acts solely as a high-performance **computation engine** for rendering complex document binaries, ensuring zero server-side data retention and immediate UI responsiveness.

### Backend Stack
- **C# / .NET 8.0 SDK** using Minimal APIs.
- **xUnit Test Architecture** for Unit and Integration tests (`WebApplicationFactory`).
- **DocumentFormat.OpenXml (OpenXML SDK 3.5.1)** for generating high-fidelity native Microsoft Word (.docx) files.

---

## ⚙️ Key Features

1. **Dynamic Schema Customization**: 
   Add, remove, or modify inventory columns (attributes) directly in the web UI. Supported data types: Text, Integer, Decimal, Date & Time, Yes/No, Enum.
2. **Internationalization (i18n)**:
   Seamless runtime switching between English and Polish languages, saving user preferences automatically in cookies.
3. **Interactive Spreadsheet Grid**: 
   Shows all database entries instantly. Columns adapt to settings (e.g., right-aligning numbers, bolding specific columns, etc.).
4. **Professional Document Exporter**:
   - **Word (.docx)**: Generates a styled table with custom margins, gray borders, blue highlighted headers, and adaptive text formatting matching C# models.
   - **Excel (.csv)**: Generates a CSV file using semicolon delimiters, fully escaped strings, and a UTF-8 BOM.
   - **Webpage (.html)**: Generates a clean standalone HTML page with inline responsive table styling.
5. **Project Backup & Restore**: Save your entire configuration and data locally as an ordinary `.json` file, and upload it back to restore the full project state.

---

## 📂 API Reference (Stateless)

| Endpoint | Method | Description |
|---|---|---|
| `/api/attributes/default/{lang}` | `GET` | Fetches the default table layout schema tailored for a specific language (`en`, `pl`) |
| `/api/export/{format}` | `POST` | Streams generated report (`docx`, `csv`, `html`). Payload must include full application state (`Attributes` & `Products`). Protected by Rate Limiting |

---

## 🛠️ Getting Started

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

## 🚀 DevOps & CI/CD
This project features a fully automated CI/CD pipeline using **GitHub Actions**. Upon every push to the `main` branch:
1. Validates the .NET Code using `dotnet build`.
2. Runs the full test suite `dotnet test`.
3. Triggers a remote deployment over a secure **Tailscale VPN** utilizing `infra/deploy.sh` to update the application running on a VPS in an NGINX Proxy Manager network.

## 📄 License
This project is licensed under the [MIT License](LICENSE).
