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

            foreach (var attr in payload.Attributes)
            {
                if (string.IsNullOrWhiteSpace(attr.Name))
                {
                    return "Attribute name cannot be empty or whitespace.";
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

                if (attr.Type == AttributeType.Enum && attr.EnumValues != null)
                {
                    if (attr.EnumValues.Count > 100)
                    {
                        return $"Attribute '{attr.Name}' exceeds maximum of 100 enum values.";
                    }

                    foreach (var enumVal in attr.EnumValues)
                    {
                        if (enumVal != null && enumVal.Length > MaxColumnNameLength)
                        {
                            return $"Enum value in '{attr.Name}' exceeds maximum length of {MaxColumnNameLength} characters.";
                        }
                    }
                }
            }

            foreach (var product in payload.Products)
            {
                if (product.Attributes == null)
                {
                    return $"Product {product.Id} attributes dictionary cannot be null.";
                }

                foreach (var (key, val) in product.Attributes)
                {
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
                    else if (val != null && val is not (bool or byte or sbyte or short or ushort or int or uint or long or ulong or float or double or decimal or DateTime or DateTimeOffset))
                    {
                        return $"Attribute value for '{key}' in product {product.Id} must be a scalar value (string, number, boolean, or null). Nested objects and arrays are forbidden.";
                    }
                }
            }

            return null;
        }
    }
}
