namespace InventoryGenerator.Api.Generators
{
    public interface IDocumentGenerator
    {
        byte[] GenerateDocument(List<Dictionary<string, object?>> data, List<string> columnHeaders, List<int> columnWidths, List<bool> columnIsBold);
    }
}
