using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace InventoryGenerator.Api.Models
{
    public enum AttributeType
    {
        String,
        Int,
        Double,
        DateTime,
        Bool,
        Enum
    }

    public class ProductAttribute
    {
        public string Name { get; set; } = string.Empty;

        [JsonConverter(typeof(JsonStringEnumConverter))]
        public AttributeType Type { get; set; } = AttributeType.String;

        public bool CanBeEmpty { get; set; }
        public List<string> EnumValues { get; set; } = new();
        public int ColumnWidth { get; set; } = 800;
        public bool IsBold { get; set; }
        public bool IsItalic { get; set; }
        public bool IsUnderline { get; set; }
    }
}
