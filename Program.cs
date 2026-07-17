using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using InventoryGenerator.Api.Models;
using InventoryGenerator.Api.Services;
using InventoryGenerator.Api.Generators;

var builder = WebApplication.CreateBuilder(args);

// Register services
builder.Services.AddSingleton<ProductService>();
builder.Services.AddSingleton<AttributeService>();

// Enable CORS
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyMethod()
              .AllowAnyHeader();
    });
});

var app = builder.Build();

app.UseCors();
app.UseDefaultFiles();
app.UseStaticFiles();

// 1. Attributes Endpoint
app.MapGet("/api/attributes", (AttributeService attrService) => 
    Results.Ok(attrService.GetAttributes()));

app.MapPost("/api/attributes", (AttributeService attrService, List<ProductAttribute> attributes) => 
{
    attrService.SetAttributes(attributes);
    return Results.Ok(attrService.GetAttributes());
});

// 2. Products Endpoints
app.MapGet("/api/products", (ProductService prodService) => 
    Results.Ok(prodService.GetProducts()));

app.MapPost("/api/products", (ProductService prodService, Dictionary<string, object?> attributes) => 
{
    var product = prodService.AddProduct(attributes);
    return Results.Created($"/api/products/{product.Id}", product);
});

app.MapPut("/api/products/{id:int}", (ProductService prodService, int id, Dictionary<string, object?> attributes) => 
{
    var updated = prodService.UpdateProduct(id, attributes);
    return updated != null ? Results.Ok(updated) : Results.NotFound();
});

app.MapDelete("/api/products/{id:int}", (ProductService prodService, int id) => 
{
    var deleted = prodService.DeleteProduct(id);
    return deleted ? Results.NoContent() : Results.NotFound();
});

app.MapPost("/api/products/clear", (ProductService prodService) => 
{
    prodService.Clear();
    return Results.Ok();
});

// 3. Project Import Endpoint
app.MapPost("/api/import", (AttributeService attrService, ProductService prodService, ImportRequest request) => 
{
    try
    {
        attrService.SetAttributes(request.Attributes);
        prodService.Clear();
        foreach (var prod in request.Products)
        {
            prodService.AddProduct(prod.Attributes);
        }
        return Results.Ok();
    }
    catch (Exception ex)
    {
        return Results.BadRequest($"Import failed: {ex.Message}");
    }
});

// 4. Export Endpoints
app.MapGet("/api/export/{format}", (ProductService prodService, AttributeService attrService, string format) => 
{
    var attributes = attrService.GetAttributes();
    var headers = attributes.Select(a => a.Name).ToList();
    var widths = attributes.Select(a => a.ColumnWidth).ToList();
    var bolds = attributes.Select(a => a.IsBold).ToList();

    var products = prodService.GetProducts();
    var data = products.Select(p => p.Attributes).ToList();

    IDocumentGenerator generator;
    string contentType;
    string fileExtension;

    switch (format.ToLower())
    {
        case "docx":
            generator = new DocxGenerator();
            contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            fileExtension = "docx";
            break;
        case "csv":
            generator = new CsvGenerator();
            contentType = "text/csv";
            fileExtension = "csv";
            break;
        case "html":
            generator = new HtmlGenerator();
            contentType = "text/html";
            fileExtension = "html";
            break;
        default:
            return Results.BadRequest("Unsupported export format. Use docx, csv, or html.");
    }

    try
    {
        var fileBytes = generator.GenerateDocument(data, headers, widths, bolds);
        var fileName = $"inventory_{DateTime.Now:yyyyMMdd_HHmmss}.{fileExtension}";
        return Results.File(fileBytes, contentType, fileName);
    }
    catch (Exception ex)
    {
        return Results.Problem($"Failed to generate document: {ex.Message}");
    }
});

app.Run();

public class ImportRequest
{
    public List<ProductAttribute> Attributes { get; set; } = new();
    public List<DynamicProduct> Products { get; set; } = new();
}
