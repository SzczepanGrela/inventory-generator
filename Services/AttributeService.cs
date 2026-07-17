using System.Collections.Generic;
using InventoryGenerator.Api.Models;

namespace InventoryGenerator.Api.Services
{
    public class AttributeService
    {
        private readonly List<ProductAttribute> _attributes = new()
        {
            new ProductAttribute { Name = "Towar", Type = AttributeType.String, CanBeEmpty = false, ColumnWidth = 1500, IsBold = false },
            new ProductAttribute { Name = "J.M.", Type = AttributeType.Enum, CanBeEmpty = false, EnumValues = new() { "Szt", "Kg", "L" }, ColumnWidth = 400, IsBold = false },
            new ProductAttribute { Name = "Ilość", Type = AttributeType.Int, CanBeEmpty = false, ColumnWidth = 800, IsBold = false },
            new ProductAttribute { Name = "Wartość", Type = AttributeType.Double, CanBeEmpty = false, ColumnWidth = 800, IsBold = false },
            new ProductAttribute { Name = "Magazyn", Type = AttributeType.Int, CanBeEmpty = false, ColumnWidth = 800, IsBold = false }
        };

        public List<ProductAttribute> GetAttributes() => _attributes;

        public void SetAttributes(List<ProductAttribute> attributes)
        {
            _attributes.Clear();
            _attributes.AddRange(attributes);
        }
    }
}
