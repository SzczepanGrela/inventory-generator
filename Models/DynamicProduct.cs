namespace InventoryGenerator.Api.Models
{
    public class DynamicProduct
    {
        public int Id { get; set; }
        public Dictionary<string, object?> Attributes { get; set; } = new();
    }
}
