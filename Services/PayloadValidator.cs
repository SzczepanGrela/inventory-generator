using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using InventoryGenerator.Api.Models;

namespace InventoryGenerator.Api.Services
{
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

        public static string? Validate(ExportPayload? payload)
        {
            if (payload == null)
            {
                return "Payload cannot be null.";
            }

            if (payload.Attributes == null || payload.Attributes.Count == 0)
            {
                return "Payload must contain at least one attribute.";
            }

            if (payload.Products == null)
            {
                return "Products list cannot be null.";
            }

            if (payload.Attributes.Count > MaxColumns)
            {
                return $"Export exceeds maximum allowed columns ({MaxColumns}). Provided: {payload.Attributes.Count}.";
            }

            if (payload.Products.Count > MaxRows)
            {
                return $"Export exceeds maximum allowed rows ({MaxRows}). Provided: {payload.Products.Count}.";
            }

            long totalCells = (long)payload.Attributes.Count * payload.Products.Count;
            if (totalCells > MaxTotalCells)
            {
                return $"Export exceeds maximum allowed total cells ({MaxTotalCells}). Provided: {totalCells}.";
            }

            var seenColumnNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            for (int i = 0; i < payload.Attributes.Count; i++)
            {
                var attr = payload.Attributes[i];
                if (attr == null)
                {
                    return $"Attribute definition at index {i} cannot be null.";
                }

                if (string.IsNullOrWhiteSpace(attr.Name))
                {
                    return $"Attribute name at index {i} cannot be empty or whitespace.";
                }

                if (attr.Name.Length > MaxColumnNameLength)
                {
                    return $"Attribute name '{attr.Name}' exceeds maximum length of {MaxColumnNameLength} characters.";
                }

                if (ForbiddenKeys.Contains(attr.Name))
                {
                    return $"Attribute name '{attr.Name}' is forbidden.";
                }

                if (attr.Name.Any(char.IsControl))
                {
                    return $"Attribute name '{attr.Name}' contains invalid control characters.";
                }

                if (!seenColumnNames.Add(attr.Name))
                {
                    return $"Duplicate attribute name: '{attr.Name}'.";
                }

                if (!Enum.IsDefined(typeof(AttributeType), attr.Type))
                {
                    return $"Attribute '{attr.Name}' has an invalid type: {attr.Type}.";
                }

                if (attr.ColumnWidth < 50 || attr.ColumnWidth > 5000)
                {
                    return $"Attribute '{attr.Name}' column width must be between 50 and 5000. Provided: {attr.ColumnWidth}.";
                }

                if (attr.Type == AttributeType.Enum)
                {
                    if (attr.EnumValues == null || attr.EnumValues.Count == 0)
                    {
                        return $"Attribute '{attr.Name}' of type Enum must contain at least one enum value.";
                    }

                    if (attr.EnumValues.Count > 100)
                    {
                        return $"Attribute '{attr.Name}' exceeds maximum of 100 enum values.";
                    }

                    foreach (var enumVal in attr.EnumValues)
                    {
                        if (enumVal == null)
                        {
                            return $"Attribute '{attr.Name}' contains a null enum value.";
                        }

                        if (enumVal.Length > MaxColumnNameLength)
                        {
                            return $"Enum value in '{attr.Name}' exceeds maximum length of {MaxColumnNameLength} characters.";
                        }
                    }
                }
            }

            for (int i = 0; i < payload.Products.Count; i++)
            {
                var product = payload.Products[i];
                if (product == null)
                {
                    return $"Product entry at index {i} cannot be null.";
                }

                if (product.Attributes == null)
                {
                    return $"Product {product.Id} attributes dictionary cannot be null.";
                }

                foreach (var (key, val) in product.Attributes)
                {
                    if (string.IsNullOrWhiteSpace(key))
                    {
                        return $"Product {product.Id} contains an empty or whitespace attribute key.";
                    }

                    if (ForbiddenKeys.Contains(key))
                    {
                        return $"Attribute key '{key}' in product {product.Id} is forbidden.";
                    }

                    if (key.Length > MaxColumnNameLength)
                    {
                        return $"Attribute key '{key}' in product {product.Id} exceeds maximum length of {MaxColumnNameLength} characters.";
                    }

                    if (val is JsonElement elem)
                    {
                        if (elem.ValueKind == JsonValueKind.Object || elem.ValueKind == JsonValueKind.Array)
                        {
                            return $"Attribute value for '{key}' in product {product.Id} must be a scalar value (string, number, boolean, or null). Nested objects and arrays are forbidden.";
                        }

                        if (elem.ValueKind == JsonValueKind.String)
                        {
                            var strVal = elem.GetString();
                            if (strVal != null && strVal.Length > MaxCellValueLength)
                            {
                                return $"Cell value for '{key}' in product {product.Id} exceeds maximum length of {MaxCellValueLength} characters.";
                            }
                        }
                    }
                    else if (val is string str)
                    {
                        if (str.Length > MaxCellValueLength)
                        {
                            return $"Cell value for '{key}' in product {product.Id} exceeds maximum length of {MaxCellValueLength} characters.";
                        }
                    }
                    else if (val is double d)
                    {
                        if (double.IsNaN(d) || double.IsInfinity(d))
                        {
                            return $"Attribute value for '{key}' in product {product.Id} contains invalid floating point value.";
                        }
                    }
                    else if (val is float f)
                    {
                        if (float.IsNaN(f) || float.IsInfinity(f))
                        {
                            return $"Attribute value for '{key}' in product {product.Id} contains invalid floating point value.";
                        }
                    }
                    else if (val != null && val is not (bool or byte or sbyte or short or ushort or int or uint or long or ulong or decimal or DateTime or DateTimeOffset))
                    {
                        return $"Attribute value for '{key}' in product {product.Id} must be a scalar value (string, number, boolean, or null). Nested objects and arrays are forbidden.";
                    }
                }
            }

            return null;
        }
    }
}
