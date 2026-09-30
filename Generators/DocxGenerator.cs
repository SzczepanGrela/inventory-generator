using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using InventoryGenerator.Api.Models;
using InventoryGenerator.Api.Services;

namespace InventoryGenerator.Api.Generators
{
    public class DocxGenerator : IDocumentGenerator
    {
        private static readonly Regex InvalidXmlCharRegex = new(
            @"[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD]",
            RegexOptions.Compiled);

        public byte[] GenerateDocument(List<Dictionary<string, object?>> data, List<ProductAttribute> attributes)
        {
            var columnHeaders = attributes.Select(a => a.Name).ToList();
            var columnWidths = attributes.Select(a => a.ColumnWidth).ToList();

            using (MemoryStream mem = new MemoryStream())
            {
                using (WordprocessingDocument wordDocument = WordprocessingDocument.Create(mem, WordprocessingDocumentType.Document))
                {
                    MainDocumentPart mainPart = wordDocument.AddMainDocumentPart();
                    mainPart.Document = new Document();
                    Body body = mainPart.Document.AppendChild(new Body());

                    // Margins
                    SectionProperties sectionProps = new SectionProperties();
                    PageMargin pageMargin = new PageMargin() { Top = 1440, Bottom = 1440, Left = 1440, Right = 1440 };
                    sectionProps.Append(pageMargin);
                    body.Append(sectionProps);

                    // Title
                    Paragraph titleParagraph = new Paragraph();
                    ParagraphProperties titleParaProps = new ParagraphProperties(
                        new Justification() { Val = JustificationValues.Center },
                        new SpacingBetweenLines() { After = "240" }
                    );
                    titleParagraph.Append(titleParaProps);
                    Run titleRun = new Run(CreateText("Inventory Report"));
                    RunProperties titleRunProps = new RunProperties(
                        new RunFonts() { Ascii = "Calibri", HighAnsi = "Calibri" },
                        new FontSize() { Val = "32" },
                        new Bold()
                    );
                    titleRun.Append(titleRunProps);
                    titleParagraph.Append(titleRun);
                    body.Append(titleParagraph);

                    // Width scaling
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
                        scaledWidths = columnHeaders.Select(_ => maxTableWidth / Math.Max(1, columnHeaders.Count)).ToList();
                    }

                    Table table = new Table();

                    TableProperties tableProperties = new TableProperties(
                        new TableWidth { Width = "5000", Type = TableWidthUnitValues.Pct },
                        new TableIndentation { Width = 0, Type = TableWidthUnitValues.Dxa },
                        new TableLayout { Type = TableLayoutValues.Fixed },
                        new TableJustification { Val = TableRowAlignmentValues.Center }
                    );

                    TableCellMargin defaultMargins = new TableCellMargin(
                        new TopMargin() { Width = "120", Type = TableWidthUnitValues.Dxa },
                        new BottomMargin() { Width = "120", Type = TableWidthUnitValues.Dxa },
                        new LeftMargin() { Width = "180", Type = TableWidthUnitValues.Dxa },
                        new RightMargin() { Width = "180", Type = TableWidthUnitValues.Dxa }
                    );
                    tableProperties.Append(defaultMargins);

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

                    TableGrid tableGrid = new TableGrid();
                    foreach (int width in scaledWidths)
                    {
                        tableGrid.Append(new GridColumn() { Width = width.ToString() });
                    }
                    table.Append(tableGrid);

                    // 1. Header Row
                    TableRow headerRow = new TableRow();
                    TableRowProperties headerRowProps = new TableRowProperties(new TableRowHeight() { Val = 400 });
                    headerRow.Append(headerRowProps);

                    for (int i = 0; i < columnHeaders.Count; i++)
                    {
                        TableCell headerCell = new TableCell();
                        TableCellProperties cellProps = new TableCellProperties(
                            new TableCellWidth { Type = TableWidthUnitValues.Dxa, Width = scaledWidths[i].ToString() },
                            new Shading() { Val = ShadingPatternValues.Clear, Color = "auto", Fill = "D9E2F3" }
                        );
                        headerCell.Append(cellProps);

                        Paragraph paragraph = new Paragraph();
                        ParagraphProperties paraProps = new ParagraphProperties(new Justification() { Val = JustificationValues.Left });
                        paragraph.Append(paraProps);

                        Run run = new Run(CreateText(columnHeaders[i]));
                        RunProperties runProps = new RunProperties(
                            new RunFonts() { Ascii = "Calibri", HighAnsi = "Calibri" },
                            new FontSize() { Val = "20" },
                            new Bold()
                        );
                        run.Append(runProps);
                        paragraph.Append(run);

                        headerCell.Append(paragraph);
                        headerRow.Append(headerCell);
                    }
                    table.Append(headerRow);

                    // 2. Data Rows
                    foreach (var rowData in data)
                    {
                        TableRow row = new TableRow();
                        TableRowProperties rowProps = new TableRowProperties(new TableRowHeight() { Val = 300 });
                        row.Append(rowProps);

                        for (int i = 0; i < attributes.Count; i++)
                        {
                            var attr = attributes[i];
                            string header = attr.Name;
                            object? value = rowData.TryGetValue(header, out var v) ? v : null;
                            string textValue = ValueHelper.ExtractScalarString(value);

                            TableCell cell = new TableCell();
                            TableCellProperties cellProps = new TableCellProperties(
                                new TableCellWidth { Type = TableWidthUnitValues.Dxa, Width = scaledWidths[i].ToString() }
                            );
                            cell.Append(cellProps);

                            Paragraph paragraph = new Paragraph();
                            bool alignRight = ValueHelper.IsNumeric(value);
                            ParagraphProperties paraProps = new ParagraphProperties(
                                new Justification() { Val = alignRight ? JustificationValues.Right : JustificationValues.Left }
                            );
                            paragraph.Append(paraProps);

                            Run run = new Run(CreateText(textValue));
                            RunProperties runProps = new RunProperties(
                                new RunFonts() { Ascii = "Calibri", HighAnsi = "Calibri" },
                                new FontSize() { Val = "20" }
                            );

                            if (attr.IsBold)
                            {
                                runProps.Append(new Bold());
                            }
                            if (attr.IsItalic)
                            {
                                runProps.Append(new Italic());
                            }
                            if (attr.IsUnderline)
                            {
                                runProps.Append(new Underline() { Val = UnderlineValues.Single });
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

        public static string SanitizeXmlString(string? value)
        {
            if (string.IsNullOrEmpty(value))
            {
                return string.Empty;
            }
            return InvalidXmlCharRegex.Replace(value, string.Empty);
        }

        private static Text CreateText(string text)
        {
            string clean = SanitizeXmlString(text);
            var textElement = new Text(clean);
            if (clean.StartsWith(' ') || clean.EndsWith(' '))
            {
                textElement.Space = SpaceProcessingModeValues.Preserve;
            }
            return textElement;
        }
    }
}
