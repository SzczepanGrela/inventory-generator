using System.Collections.Generic;
using InventoryGenerator.Api.Models;

namespace InventoryGenerator.Api.Generators
{
    public interface IDocumentGenerator
    {
        byte[] GenerateDocument(List<Dictionary<string, object?>> data, List<ProductAttribute> attributes);
    }
}
