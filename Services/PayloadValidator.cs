using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using InventoryGenerator.Api.Models;

namespace InventoryGenerator.Api.Services
{
    public sealed record ValidationOutcome(
        bool IsValid,
        string? ErrorCode,
        string? ErrorMessage,
        int ColumnsCount = 0,
        int RowsCount = 0)
    {
        public static ValidationOutcome Success(int columns, int rows) =>
            new(true, null, null, columns, rows);

        public static ValidationOutcome Failure(string errorCode, string errorMessage, int columns = 0, int rows = 0) =>
            new(false, errorCode, errorMessage, columns, rows);
    }

    public static class PayloadValidator
    {
        public const int MaxColumns = 50;
        public const int MaxRows = 5000;
        public const int MaxTotalCells = 50000;
        public const int MaxColumnNameLength = 100;
        public const int MaxCellValueLength = 1000;

        private static readonly HashSet<string> ForbiddenKeys = new(StringComparer.OrdinalIgnoreCase)
        {
            "__proto__",
            "constructor",
            "prototype",
            "$type"
        };

        public static string? Validate(ExportPayload? payload) => ValidatePayload(payload).ErrorMessage;

        public static ValidationOutcome ValidatePayload(ExportPayload? payload)
        {
            if (payload == null)
            {
                return ValidationOutcome.Failure("PAYLOAD_NULL", "Payload cannot be null.", 0, 0);
            }

            int colsCount = payload.Attributes?.Count ?? 0;
            int rowsCount = payload.Products?.Count ?? 0;

            if (payload.Attributes == null || payload.Attributes.Count == 0)
            {
                return ValidationOutcome.Failure("ATTRIBUTES_EMPTY", "Payload must contain at least one attribute.", colsCount, rowsCount);
            }

            if (payload.Products == null)
            {
                return ValidationOutcome.Failure("PRODUCTS_NULL", "Products list cannot be null.", colsCount, rowsCount);
            }

            if (payload.Attributes.Count > MaxColumns)
            {
                return ValidationOutcome.Failure("MAX_COLUMNS_EXCEEDED", $"Export exceeds maximum allowed columns ({MaxColumns}). Provided: {payload.Attributes.Count}.", colsCount, rowsCount);
            }

            if (payload.Products.Count > MaxRows)
            {
                return ValidationOutcome.Failure("MAX_ROWS_EXCEEDED", $"Export exceeds maximum allowed rows ({MaxRows}). Provided: {payload.Products.Count}.", colsCount, rowsCount);
            }

            long totalCells = (long)payload.Attributes.Count * payload.Products.Count;
            if (totalCells > MaxTotalCells)
            {
                return ValidationOutcome.Failure("MAX_TOTAL_CELLS_EXCEEDED", $"Export exceeds maximum allowed total cells ({MaxTotalCells}). Provided: {totalCells}.", colsCount, rowsCount);
            }

            var seenColumnNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            for (int i = 0; i < payload.Attributes.Count; i++)
            {
                var attr = payload.Attributes[i];
                if (attr == null)
                {
                    return ValidationOutcome.Failure("ATTRIBUTE_NULL", $"Attribute definition at index {i} cannot be null.", colsCount, rowsCount);
                }

                if (string.IsNullOrWhiteSpace(attr.Name))
                {
                    return ValidationOutcome.Failure("ATTRIBUTE_NAME_EMPTY", $"Attribute name at index {i} cannot be empty or whitespace.", colsCount, rowsCount);
                }

                if (attr.Name.Length > MaxColumnNameLength)
                {
                    return ValidationOutcome.Failure("ATTRIBUTE_NAME_LENGTH", $"Attribute name at index {i} exceeds maximum length of {MaxColumnNameLength} characters.", colsCount, rowsCount);
                }

                if (ForbiddenKeys.Contains(attr.Name))
                {
                    return ValidationOutcome.Failure("ATTRIBUTE_NAME_FORBIDDEN", $"Attribute name at index {i} is forbidden.", colsCount, rowsCount);
                }

                if (attr.Name.Any(char.IsControl))
                {
                    return ValidationOutcome.Failure("ATTRIBUTE_NAME_CONTROL_CHARS", $"Attribute name at index {i} contains invalid control characters.", colsCount, rowsCount);
                }

                if (!seenColumnNames.Add(attr.Name))
                {
                    return ValidationOutcome.Failure("DUPLICATE_ATTRIBUTE_NAME", $"Duplicate attribute name at index {i}.", colsCount, rowsCount);
                }

                if (!Enum.IsDefined(typeof(AttributeType), attr.Type))
                {
                    return ValidationOutcome.Failure("INVALID_ATTRIBUTE_TYPE", $"Attribute at index {i} has an invalid type: {attr.Type}.", colsCount, rowsCount);
                }

                if (attr.ColumnWidth < 50 || attr.ColumnWidth > 5000)
                {
                    return ValidationOutcome.Failure("INVALID_COLUMN_WIDTH", $"Attribute at index {i} column width must be between 50 and 5000. Provided: {attr.ColumnWidth}.", colsCount, rowsCount);
                }

                if (attr.Type == AttributeType.Enum)
                {
                    if (attr.EnumValues == null || attr.EnumValues.Count == 0)
                    {
                        return ValidationOutcome.Failure("INVALID_ENUM_VALUES", $"Attribute at index {i} of type Enum must contain at least one enum value.", colsCount, rowsCount);
                    }

                    if (attr.EnumValues.Count > 100)
                    {
                        return ValidationOutcome.Failure("INVALID_ENUM_VALUES", $"Attribute at index {i} exceeds maximum of 100 enum values.", colsCount, rowsCount);
                    }

                    foreach (var enumVal in attr.EnumValues)
                    {
                        if (enumVal == null)
                        {
                            return ValidationOutcome.Failure("INVALID_ENUM_VALUES", $"Attribute at index {i} contains a null enum value.", colsCount, rowsCount);
                        }

                        if (enumVal.Length > MaxColumnNameLength)
                        {
                            return ValidationOutcome.Failure("INVALID_ENUM_VALUES", $"Enum value in attribute at index {i} exceeds maximum length of {MaxColumnNameLength} characters.", colsCount, rowsCount);
                        }
                    }
                }
            }

            for (int i = 0; i < payload.Products.Count; i++)
            {
                var product = payload.Products[i];
                if (product == null)
                {
                    return ValidationOutcome.Failure("PRODUCT_NULL", $"Product entry at index {i} cannot be null.", colsCount, rowsCount);
                }

                if (product.Attributes == null)
                {
                    return ValidationOutcome.Failure("PRODUCT_ATTRIBUTES_NULL", $"Product {product.Id} attributes dictionary cannot be null.", colsCount, rowsCount);
                }

                foreach (var (key, val) in product.Attributes)
                {
                    if (string.IsNullOrWhiteSpace(key))
                    {
                        return ValidationOutcome.Failure("ATTRIBUTE_KEY_EMPTY", $"Product {product.Id} contains an empty or whitespace attribute key.", colsCount, rowsCount);
                    }

                    if (ForbiddenKeys.Contains(key))
                    {
                        return ValidationOutcome.Failure("ATTRIBUTE_KEY_FORBIDDEN", $"Attribute key in product {product.Id} is forbidden.", colsCount, rowsCount);
                    }

                    if (key.Length > MaxColumnNameLength)
                    {
                        return ValidationOutcome.Failure("ATTRIBUTE_KEY_LENGTH", $"Attribute key in product {product.Id} exceeds maximum length of {MaxColumnNameLength} characters.", colsCount, rowsCount);
                    }

                    if (val is JsonElement elem)
                    {
                        if (elem.ValueKind == JsonValueKind.Object || elem.ValueKind == JsonValueKind.Array)
                        {
                            return ValidationOutcome.Failure("INVALID_ATTRIBUTE_VALUE_TYPE", $"Attribute value in product {product.Id} must be a scalar value (string, number, boolean, or null). Nested objects and arrays are forbidden.", colsCount, rowsCount);
                        }

                        if (elem.ValueKind == JsonValueKind.String)
                        {
                            var strVal = elem.GetString();
                            if (strVal != null && strVal.Length > MaxCellValueLength)
                            {
                                return ValidationOutcome.Failure("MAX_CELL_VALUE_LENGTH", $"Cell value in product {product.Id} exceeds maximum length of {MaxCellValueLength} characters.", colsCount, rowsCount);
                            }
                        }
                    }
                    else if (val is string str)
                    {
                        if (str.Length > MaxCellValueLength)
                        {
                            return ValidationOutcome.Failure("MAX_CELL_VALUE_LENGTH", $"Cell value in product {product.Id} exceeds maximum length of {MaxCellValueLength} characters.", colsCount, rowsCount);
                        }
                    }
                    else if (val is double d)
                    {
                        if (double.IsNaN(d) || double.IsInfinity(d))
                        {
                            return ValidationOutcome.Failure("INVALID_FLOATING_POINT", $"Attribute value in product {product.Id} contains invalid floating point value.", colsCount, rowsCount);
                        }
                    }
                    else if (val is float f)
                    {
                        if (float.IsNaN(f) || float.IsInfinity(f))
                        {
                            return ValidationOutcome.Failure("INVALID_FLOATING_POINT", $"Attribute value in product {product.Id} contains invalid floating point value.", colsCount, rowsCount);
                        }
                    }
                    else if (val != null && val is not (bool or byte or sbyte or short or ushort or int or uint or long or ulong or decimal or DateTime or DateTimeOffset))
                    {
                        return ValidationOutcome.Failure("INVALID_ATTRIBUTE_VALUE_TYPE", $"Attribute value in product {product.Id} must be a scalar value (string, number, boolean, or null). Nested objects and arrays are forbidden.", colsCount, rowsCount);
                    }
                }
            }

            return ValidationOutcome.Success(colsCount, rowsCount);
        }
    }
}
