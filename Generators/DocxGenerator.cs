using System.Collections.Generic;
using System.IO;
using System.Linq;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;

namespace InventoryGenerator.Api.Generators
{
    public class DocxGenerator : IDocumentGenerator
    {
        public byte[] GenerateDocument(List<Dictionary<string, object?>> data, List<string> columnHeaders, List<int> columnWidths, List<bool> columnIsBold)
        {
            using (MemoryStream mem = new MemoryStream())
            {
                using (WordprocessingDocument wordDocument = WordprocessingDocument.Create(mem, WordprocessingDocumentType.Document))
                {
                    MainDocumentPart mainPart = wordDocument.AddMainDocumentPart();
                    mainPart.Document = new Document();
                    Body body = mainPart.Document.AppendChild(new Body());

                    // Configure section margins for document (standard 1 inch / 1440 dxa)
                    SectionProperties sectionProps = new SectionProperties();
                    PageMargin pageMargin = new PageMargin() { Top = 1440, Bottom = 1440, Left = 1440, Right = 1440 };
                    sectionProps.Append(pageMargin);
                    body.Append(sectionProps);

                    // Add title
                    Paragraph titleParagraph = new Paragraph();
                    ParagraphProperties titleParaProps = new ParagraphProperties(
                        new Justification() { Val = JustificationValues.Center },
                        new SpacingBetweenLines() { After = "240" } // 12pt space after title
                    );
                    titleParagraph.Append(titleParaProps);
                    Run titleRun = new Run(new Text("Inventory Report"));
                    RunProperties titleRunProps = new RunProperties(
                        new RunFonts() { Ascii = "Calibri", HighAnsi = "Calibri" },
                        new FontSize() { Val = "32" }, // 16pt
                        new Bold()
                    );
                    titleRun.Append(titleRunProps);
                    titleParagraph.Append(titleRun);
                    body.Append(titleParagraph);

                    // Scale column widths to fit a total of ~9350 dxa (standard printable width)
                    int maxTableWidth = 9350;
                    int totalInputWidth = columnWidths.Sum();
                    List<int> scaledWidths = new List<int>();
                    if (totalInputWidth > 0)
                    {
                        double ratio = (double)maxTableWidth / totalInputWidth;
                        scaledWidths = columnWidths.Select(w => (int)(w * ratio)).ToList();
                    }
                    else
                    {
                        scaledWidths = columnHeaders.Select(_ => maxTableWidth / columnHeaders.Count).ToList();
                    }

                    Table table = new Table();

                    // Table properties
                    TableProperties tableProperties = new TableProperties(
                        new TableWidth { Width = "5000", Type = TableWidthUnitValues.Pct }, // 100% page width
                        new TableIndentation { Width = 0, Type = TableWidthUnitValues.Dxa },
                        new TableLayout { Type = TableLayoutValues.Fixed },
                        new TableJustification { Val = TableRowAlignmentValues.Center }
                    );

                    // Default cell margins (padding) - top/bottom: 120 dxa (~6pt), left/right: 180 dxa (~9pt)
                    TableCellMargin defaultMargins = new TableCellMargin(
                        new TopMargin() { Width = "120", Type = TableWidthUnitValues.Dxa },
                        new BottomMargin() { Width = "120", Type = TableWidthUnitValues.Dxa },
                        new LeftMargin() { Width = "180", Type = TableWidthUnitValues.Dxa },
                        new RightMargin() { Width = "180", Type = TableWidthUnitValues.Dxa }
                    );
                    tableProperties.Append(defaultMargins);

                    // Table borders (sleek, light gray borders)
                    TableBorders tableBorders = new TableBorders(
                        new TopBorder { Val = BorderValues.Single, Size = 4, Color = "CCCCCC" },
                        new BottomBorder { Val = BorderValues.Single, Size = 4, Color = "CCCCCC" },
                        new LeftBorder { Val = BorderValues.Single, Size = 4, Color = "CCCCCC" },
                        new RightBorder { Val = BorderValues.Single, Size = 4, Color = "CCCCCC" },
                        new InsideHorizontalBorder { Val = BorderValues.Single, Size = 4, Color = "E0E0E0" },
                        new InsideVerticalBorder { Val = BorderValues.Single, Size = 4, Color = "E0E0E0" }
                    );
                    tableProperties.Append(tableBorders);
                    table.AppendChild(tableProperties);

                    // Add Table Grid
                    TableGrid tableGrid = new TableGrid();
                    foreach (int width in scaledWidths)
                    {
                        tableGrid.Append(new GridColumn() { Width = width.ToString() });
                    }
                    table.Append(tableGrid);

                    // 1. Add Header Row
                    TableRow headerRow = new TableRow();
                    TableRowProperties headerRowProps = new TableRowProperties(new TableRowHeight() { Val = 400 });
                    headerRow.Append(headerRowProps);

                    for (int i = 0; i < columnHeaders.Count; i++)
                    {
                        TableCell headerCell = new TableCell();
                        TableCellProperties cellProps = new TableCellProperties(
                            new TableCellWidth { Type = TableWidthUnitValues.Dxa, Width = scaledWidths[i].ToString() },
                            new Shading() { Val = ShadingPatternValues.Clear, Color = "auto", Fill = "D9E2F3" } // light blue header
                        );
                        headerCell.Append(cellProps);

                        Paragraph paragraph = new Paragraph();
                        ParagraphProperties paraProps = new ParagraphProperties(new Justification() { Val = JustificationValues.Left });
                        paragraph.Append(paraProps);

                        Run run = new Run(new Text(columnHeaders[i]));
                        RunProperties runProps = new RunProperties(
                            new RunFonts() { Ascii = "Calibri", HighAnsi = "Calibri" },
                            new FontSize() { Val = "20" }, // 10pt
                            new Bold()
                        );
                        run.Append(runProps);
                        paragraph.Append(run);

                        headerCell.Append(paragraph);
                        headerRow.Append(headerCell);
                    }
                    table.Append(headerRow);

                    // 2. Add Data Rows
                    foreach (var rowData in data)
                    {
                        TableRow row = new TableRow();
                        TableRowProperties rowProps = new TableRowProperties(new TableRowHeight() { Val = 300 });
                        row.Append(rowProps);

                        for (int i = 0; i < columnHeaders.Count; i++)
                        {
                            string header = columnHeaders[i];
                            object? value = rowData.ContainsKey(header) ? rowData[header] : "";
                            string textValue = value?.ToString() ?? string.Empty;

                            TableCell cell = new TableCell();
                            TableCellProperties cellProps = new TableCellProperties(
                                new TableCellWidth { Type = TableWidthUnitValues.Dxa, Width = scaledWidths[i].ToString() }
                            );
                            cell.Append(cellProps);

                            Paragraph paragraph = new Paragraph();
                            bool alignRight = IsNumeric(value);
                            ParagraphProperties paraProps = new ParagraphProperties(
                                new Justification() { Val = alignRight ? JustificationValues.Right : JustificationValues.Left }
                            );
                            paragraph.Append(paraProps);

                            Run run = new Run(new Text(textValue));
                            RunProperties runProps = new RunProperties(
                                new RunFonts() { Ascii = "Calibri", HighAnsi = "Calibri" },
                                new FontSize() { Val = "20" }
                            );
                            
                            if (columnIsBold.Count > i && columnIsBold[i])
                            {
                                runProps.Append(new Bold());
                            }

                            run.Append(runProps);
                            paragraph.Append(run);

                            cell.Append(paragraph);
                            row.Append(cell);
                        }
                        table.Append(row);
                    }

                    body.Append(table);
                    wordDocument.Save();
                }
                return mem.ToArray();
            }
        }

        private bool IsNumeric(object? value)
        {
            if (value == null) return false;
            if (value is int || value is double || value is float || value is decimal || value is long || value is short) return true;
            string str = value.ToString() ?? "";
            if (string.IsNullOrWhiteSpace(str)) return false;
            return double.TryParse(str, out _) || int.TryParse(str, out _);
        }
    }
}
