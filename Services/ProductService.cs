using System.Collections.Generic;
using System.Linq;
using InventoryGenerator.Api.Models;

namespace InventoryGenerator.Api.Services
{
    public class ProductService
    {
        private readonly List<DynamicProduct> _products = new();
        private int _nextId = 1;

        public List<DynamicProduct> GetProducts() => _products;

        public DynamicProduct AddProduct(Dictionary<string, object?> attributes)
        {
            var product = new DynamicProduct
            {
                Id = _nextId++,
                Attributes = attributes
            };
            _products.Add(product);
            return product;
        }

        public DynamicProduct? UpdateProduct(int id, Dictionary<string, object?> attributes)
        {
            var existing = _products.FirstOrDefault(p => p.Id == id);
            if (existing != null)
            {
                existing.Attributes = attributes;
            }
            return existing;
        }

        public bool DeleteProduct(int id)
        {
            var existing = _products.FirstOrDefault(p => p.Id == id);
            if (existing != null)
            {
                _products.Remove(existing);
                return true;
            }
            return false;
        }

        public void Clear()
        {
            _products.Clear();
            _nextId = 1;
        }
    }
}
