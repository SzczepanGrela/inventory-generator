using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using InventoryGenerator.Api.Models;

namespace InventoryGenerator.Api.Services
{
    public class AttributeService
    {
        private readonly string _settingsFilePath = Path.Combine(AppContext.BaseDirectory, "Settings", "Attributes.json");
        private readonly List<ProductAttribute> _attributes = new();

        public AttributeService()
        {
            LoadAttributesFromDisk();
        }

        public List<ProductAttribute> GetAttributes() => _attributes;

        public void SetAttributes(List<ProductAttribute> attributes)
        {
            _attributes.Clear();
            _attributes.AddRange(attributes);
            SaveAttributesToDisk();
        }

        private void LoadAttributesFromDisk()
        {
            try
            {
                // Ensure the Settings directory exists
                string directory = Path.GetDirectoryName(_settingsFilePath) ?? string.Empty;
                if (!string.IsNullOrEmpty(directory) && !Directory.Exists(directory))
                {
                    Directory.CreateDirectory(directory);
                }

                if (File.Exists(_settingsFilePath))
                {
                    string json = File.ReadAllText(_settingsFilePath);
                    var loaded = JsonSerializer.Deserialize<List<ProductAttribute>>(json);
                    if (loaded != null && loaded.Count > 0)
                    {
                        _attributes.AddRange(loaded);
                        return;
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error loading columns config from disk: {ex.Message}");
            }

            // Fallback to default columns if file missing or corrupted
            LoadDefaultAttributes();
        }

        private void SaveAttributesToDisk()
        {
            try
            {
                string directory = Path.GetDirectoryName(_settingsFilePath) ?? string.Empty;
                if (!string.IsNullOrEmpty(directory) && !Directory.Exists(directory))
                {
                    Directory.CreateDirectory(directory);
                }

                var options = new JsonSerializerOptions { WriteIndented = true };
                string json = JsonSerializer.Serialize(_attributes, options);
                File.WriteAllText(_settingsFilePath, json);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error saving columns config to disk: {ex.Message}");
            }
        }

        private void LoadDefaultAttributes()
        {
            _attributes.Clear();
            _attributes.AddRange(new List<ProductAttribute>
            {
                new ProductAttribute { Name = "Towar", Type = AttributeType.String, CanBeEmpty = false, ColumnWidth = 1500, IsBold = false },
                new ProductAttribute { Name = "J.M.", Type = AttributeType.Enum, CanBeEmpty = false, EnumValues = new() { "Szt", "Kg", "L" }, ColumnWidth = 400, IsBold = false },
                new ProductAttribute { Name = "Ilość", Type = AttributeType.Int, CanBeEmpty = false, ColumnWidth = 800, IsBold = false },
                new ProductAttribute { Name = "Wartość", Type = AttributeType.Double, CanBeEmpty = false, ColumnWidth = 800, IsBold = false },
                new ProductAttribute { Name = "Magazyn", Type = AttributeType.Int, CanBeEmpty = false, ColumnWidth = 800, IsBold = false }
            });
            SaveAttributesToDisk();
        }
    }
}
