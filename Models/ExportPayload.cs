using System.Collections.Generic;

namespace InventoryGenerator.Api.Models
{
    public class ExportPayload
    {
        public List<ProductAttribute> Attributes { get; set; } = new();
        public List<DynamicProduct> Products { get; set; } = new();
    }
}
