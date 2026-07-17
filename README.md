# Inventory Generator

A modern full-stack web application designed for creating and managing product inventory databases and generating professional reports in **Word (.docx)**, **Excel (.csv)**, and **Webpage (.html)** formats. 

Originally created as a Windows Forms desktop application (May 2024), this project was redesigned and rewritten as a responsive web application to enable server deployment and cross-platform accessibility.

---

## 🎨 Design & Aesthetics
The application features a premium dark-themed design built from scratch with modern web techniques:
- **Glassmorphism panels**: Translucent layouts utilizing `backdrop-filter` blur effects.
- **Dynamic glows**: Smooth background color washes that float behind UI blocks.
- **Custom typography**: Clean interfaces using the **Outfit** Google Font.
- **Subtle micro-animations**: Smooth hover transitions, loading feedback, and toast notification slides.
- **Responsive design**: Seamless layout adaptations across mobile, tablet, and desktop viewports.

---

## 🚀 Architecture & Technical Stack

```
┌──────────────────────────────┐       HTTP/REST       ┌─────────────────────────────┐
│       Frontend (Browser)     │  ◄──────────────────►  │    Backend (API Server)      │
│                              │                        │                             │
│  • HTML5 / CSS3 (Vanilla)    │   GET /api/products    │  • C# ASP.NET Core 8        │
│  • Modern ES6 JavaScript     │   POST /api/products   │  • Minimal API Architecture │
│  • Dynamic Form rendering    │   GET /api/attributes  │  • OpenXML SDK 3.5          │
│  • Live Spreadsheet Table    │   POST /api/export     │  • IDocumentGenerator       │
│  • Client-side validation    │                        │  • In-memory Data Service   │
└──────────────────────────────┘                        └─────────────────────────────┘
```

### Backend
- **C# / .NET 8.0 SDK** using Minimal APIs for high performance and low footprint.
- **DocumentFormat.OpenXml (OpenXML SDK 3.5.1)** for generating high-fidelity native Microsoft Word (.docx) files.
- **Polymorphic document generation** via the `IDocumentGenerator` interface.

### Frontend
- **Vanilla HTML5 & CSS3** utilizing custom CSS variables for design system consistency.
- **Modern ES6 JavaScript** for rendering dynamic tables and forms based on current database schemas.
- **FontAwesome 6** for beautiful vector icons.

---

## ⚙️ Key Features

1. **Dynamic Schema Customization**: 
   Add, remove, or modify inventory columns (attributes) directly in the web UI. Supported data types:
   - **Text (String)**
   - **Integer (Int)**
   - **Decimal (Double)**
   - **Date & Time (DateTime)**
   - **Yes/No (Bool)**
   - **Dropdown Selection (Enum)**
2. **Dynamic Form Rendering**: The insert form on the left pane adapts in real time when you add or remove column attributes (e.g., displaying calendar picks for dates, number fields, select menus, etc.).
3. **Interactive Spreadsheet Grid**: Shows all database entries instantly. Columns adapt to settings (e.g., right-aligning numbers, bolding specific columns, etc.). Includes edit and delete controls.
4. **Professional Document Exporter**:
   - **Word (.docx)**: Generates a pixel-perfect styled table with custom margins, light gray borders, light-blue highlighted headers, and right-aligned text matching C# backend attributes.
   - **Excel (.csv)**: Generates a CSV file using semicolon delimiters, fully escaped strings, and a UTF-8 Byte Order Mark (BOM) to guarantee compatibility with MS Excel.
   - **Webpage (.html)**: Generates a clean standalone HTML page with inline responsive table styling.
5. **Project Backup & Restore**: Save your entire configuration and data locally as an ordinary `.json` file, and upload it back to restore the full project state.

---

## 📂 API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/api/attributes` | `GET` | Retrieve the active table columns and configuration |
| `/api/attributes` | `POST` | Update columns definition schema (accepts JSON array) |
| `/api/products` | `GET` | Get all stored inventory items |
| `/api/products` | `POST` | Add a new inventory item |
| `/api/products/{id}` | `PUT` | Update an existing item |
| `/api/products/{id}` | `DELETE` | Remove an item |
| `/api/products/clear` | `POST` | Wipe all records from the in-memory database |
| `/api/import` | `POST` | Import a full project state `{ attributes, products }` |
| `/api/export/{format}` | `GET` | Stream generated report. Supported format parameters: `docx`, `csv`, `html` |

---

## 🛠️ Getting Started

### Prerequisites
- [.NET 8.0 SDK](https://dotnet.microsoft.com/download)

### Run the Application
1. Clone this repository:
   ```bash
   git clone https://github.com/SzczepanGrela/inventory-generator.git
   cd inventory-generator
   ```
2. Build and run the project:
   ```bash
   dotnet run
   ```
3. Open your browser and navigate to:
   ```
   http://localhost:5000
   ```

---

## 📄 License
This project is licensed under the [MIT License](LICENSE).
