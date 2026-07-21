using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.DependencyInjection;
using InventoryGenerator.Api.Models;
using InventoryGenerator.Api.Generators;

var builder = WebApplication.CreateBuilder(args);

// Bind to PORT environment variable if provided by cloud host (Render, Fly.io, Railway, etc.)
var port = Environment.GetEnvironmentVariable("PORT");
if (!string.IsNullOrEmpty(port))
{
    builder.WebHost.UseUrls($"http://0.0.0.0:{port}");
}

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

// Configure Rate Limiting to protect export endpoints against DoS
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddFixedWindowLimiter("exportPolicy", opt =>
    {
        opt.Window = TimeSpan.FromMinutes(1);
        opt.PermitLimit = 30; // Max 30 exports per minute
        opt.QueueLimit = 0;
    });
});

var app = builder.Build();

app.UseCors();
app.UseRateLimiter();
app.UseDefaultFiles();
app.UseStaticFiles();

// 1. Get Default Attributes Endpoint (Stateless template for new users)
app.MapGet("/api/attributes/default", () => 
{
    var defaultAttributes = new List<ProductAttribute>
    {
        new ProductAttribute { Name = "Towar", Type = AttributeType.String, CanBeEmpty = false, ColumnWidth = 1500, IsBold = false, IsItalic = false, IsUnderline = false },
        new ProductAttribute { Name = "J.M.", Type = AttributeType.Enum, CanBeEmpty = false, EnumValues = new() { "Szt", "Kg", "L" }, ColumnWidth = 400, IsBold = false, IsItalic = false, IsUnderline = false },
        new ProductAttribute { Name = "Ilość", Type = AttributeType.Int, CanBeEmpty = false, ColumnWidth = 800, IsBold = false, IsItalic = false, IsUnderline = false },
        new ProductAttribute { Name = "Wartość", Type = AttributeType.Double, CanBeEmpty = false, ColumnWidth = 800, IsBold = false, IsItalic = false, IsUnderline = false },
        new ProductAttribute { Name = "Magazyn", Type = AttributeType.Int, CanBeEmpty = false, ColumnWidth = 800, IsBold = false, IsItalic = false, IsUnderline = false }
    };
    return Results.Ok(defaultAttributes);
});

// 2. Stateless Export Endpoint (Receives Local-First payload from client and returns generated file)
app.MapPost("/api/export/{format}", (ExportPayload payload, string format) => 
{
    if (payload == null || payload.Attributes == null || payload.Products == null)
    {
        return Results.BadRequest("Payload must contain attributes and products.");
    }

    var attributes = payload.Attributes;
    var data = payload.Products.Select(p => p.Attributes).ToList();

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
        var fileBytes = generator.GenerateDocument(data, attributes);
        var fileName = $"inventory_{DateTime.Now:yyyyMMdd_HHmmss}.{fileExtension}";
        return Results.File(fileBytes, contentType, fileName);
    }
    catch (Exception ex)
    {
        return Results.Problem($"Failed to generate document: {ex.Message}");
    }
}).RequireRateLimiting("exportPolicy");

app.Run();

public class ExportPayload
{
    public List<ProductAttribute> Attributes { get; set; } = new();
    public List<DynamicProduct> Products { get; set; } = new();
}
