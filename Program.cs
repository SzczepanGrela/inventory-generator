using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net;
using System.Text.Json.Serialization.Metadata;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using InventoryGenerator.Api.Models;
using InventoryGenerator.Api.Generators;
using InventoryGenerator.Api.Services;

static string GetRateLimitPartitionKey(HttpContext context)
{
    return context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
}

static IReadOnlyList<IPAddress> ParseTrustedProxyIps(string? value)
{
    if (string.IsNullOrWhiteSpace(value))
    {
        return Array.Empty<IPAddress>();
    }

    var trustedProxies = new List<IPAddress>();
    foreach (var item in value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
    {
        if (!IPAddress.TryParse(item, out var address))
        {
            throw new InvalidOperationException($"TRUSTED_PROXY_IPS contains an invalid IP address: '{item}'.");
        }

        if (!trustedProxies.Contains(address))
        {
            trustedProxies.Add(address);
        }
    }

    return trustedProxies;
}

var builder = WebApplication.CreateBuilder(args);
var releaseRevision = Environment.GetEnvironmentVariable("RELEASE_REVISION") ?? "development";
var trustedProxyIps = ParseTrustedProxyIps(builder.Configuration["TRUSTED_PROXY_IPS"]);

if (trustedProxyIps.Count > 0)
{
    builder.Services.Configure<ForwardedHeadersOptions>(options =>
    {
        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor;
        options.ForwardLimit = trustedProxyIps.Count;
        options.KnownIPNetworks.Clear();
        options.KnownProxies.Clear();

        foreach (var address in trustedProxyIps)
        {
            options.KnownProxies.Add(address);
        }
    });
}

// Bind to PORT environment variable if provided by cloud host
var port = Environment.GetEnvironmentVariable("PORT");
if (!string.IsNullOrEmpty(port))
{
    builder.WebHost.UseUrls($"http://0.0.0.0:{port}");
}

// Kestrel request body limit: 2 MB maximum
builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = 2 * 1024 * 1024;
});

// Configure JSON options: prevent polymorphism RCE gadgets and deep nesting DoS
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.MaxDepth = 8;
    options.SerializerOptions.TypeInfoResolver = new DefaultJsonTypeInfoResolver();
    options.SerializerOptions.PropertyNameCaseInsensitive = true;
});

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

// Export rate limiter (shared client budget + docx burst + concurrency cap)
builder.Services.AddSingleton<ExportRateLimiter>();

// Configure ASP.NET Core Rate Limiting for read endpoints (~120 requests/min per IP)
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("readPolicy", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: GetRateLimitPartitionKey(context),
            factory: _ => new FixedWindowRateLimiterOptions
            {
                AutoReplenishment = true,
                Window = TimeSpan.FromMinutes(1),
                PermitLimit = 120,
                QueueLimit = 0
            }));
});

var app = builder.Build();

if (trustedProxyIps.Count > 0)
{
    app.UseForwardedHeaders();
}

// Security headers: strict CSP (Google Fonts, FontAwesome CDN, blob, self), nosniff, frame denial, and referrer policy
app.Use(async (context, next) =>
{
    context.Response.Headers["Content-Security-Policy"] =
        "default-src 'self'; " +
        "script-src 'self'; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; " +
        "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; " +
        "img-src 'self' data: blob:; " +
        "connect-src 'self'; " +
        "frame-ancestors 'none'; " +
        "base-uri 'self'; " +
        "form-action 'self';";

    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["X-Frame-Options"] = "DENY";
    context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    context.Response.Headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";

    await next();
});

app.UseCors();
app.UseRateLimiter();

// Early rejection of request bodies exceeding 2MB before deserialization
app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/api/export", StringComparison.OrdinalIgnoreCase) &&
        HttpMethods.IsPost(context.Request.Method))
    {
        if (context.Request.ContentLength.HasValue && context.Request.ContentLength.Value > 2 * 1024 * 1024)
        {
            context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
            await context.Response.WriteAsJsonAsync(new
            {
                status = StatusCodes.Status413PayloadTooLarge,
                title = "Payload Too Large",
                detail = "Request body exceeds 2MB limit."
            });
            return;
        }
    }

    try
    {
        await next();
    }
    catch (BadHttpRequestException ex) when (ex.StatusCode == StatusCodes.Status413PayloadTooLarge)
    {
        if (!context.Response.HasStarted)
        {
            context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
            await context.Response.WriteAsJsonAsync(new
            {
                status = StatusCodes.Status413PayloadTooLarge,
                title = "Payload Too Large",
                detail = "Request body exceeds 2MB limit."
            });
        }
    }
});

app.UseDefaultFiles();
app.UseStaticFiles();

// Health Endpoint
app.MapGet("/api/health", () => Results.Ok(new
{
    status = "ok",
    revision = releaseRevision
})).RequireRateLimiting("readPolicy");

// 1. Get Default Attributes Endpoint
app.MapGet("/api/attributes/default/{lang?}", (string? lang) => 
{
    bool isEn = string.Equals(lang ?? "en", "en", StringComparison.OrdinalIgnoreCase);
    
    var defaultAttributes = isEn ? new List<ProductAttribute>
    {
        new ProductAttribute { Name = "Item", Type = AttributeType.String, CanBeEmpty = false, ColumnWidth = 1500, IsBold = false, IsItalic = false, IsUnderline = false },
        new ProductAttribute { Name = "UOM", Type = AttributeType.Enum, CanBeEmpty = false, EnumValues = new() { "Pcs", "Kg", "L" }, ColumnWidth = 400, IsBold = false, IsItalic = false, IsUnderline = false },
        new ProductAttribute { Name = "Quantity", Type = AttributeType.Int, CanBeEmpty = false, ColumnWidth = 800, IsBold = false, IsItalic = false, IsUnderline = false },
        new ProductAttribute { Name = "Value", Type = AttributeType.Double, CanBeEmpty = false, ColumnWidth = 800, IsBold = false, IsItalic = false, IsUnderline = false },
        new ProductAttribute { Name = "Warehouse", Type = AttributeType.Int, CanBeEmpty = false, ColumnWidth = 800, IsBold = false, IsItalic = false, IsUnderline = false }
    } : new List<ProductAttribute>
    {
        new ProductAttribute { Name = "Towar", Type = AttributeType.String, CanBeEmpty = false, ColumnWidth = 1500, IsBold = false, IsItalic = false, IsUnderline = false },
        new ProductAttribute { Name = "J.M.", Type = AttributeType.Enum, CanBeEmpty = false, EnumValues = new() { "Szt", "Kg", "L" }, ColumnWidth = 400, IsBold = false, IsItalic = false, IsUnderline = false },
        new ProductAttribute { Name = "Ilość", Type = AttributeType.Int, CanBeEmpty = false, ColumnWidth = 800, IsBold = false, IsItalic = false, IsUnderline = false },
        new ProductAttribute { Name = "Wartość", Type = AttributeType.Double, CanBeEmpty = false, ColumnWidth = 800, IsBold = false, IsItalic = false, IsUnderline = false },
        new ProductAttribute { Name = "Magazyn", Type = AttributeType.Int, CanBeEmpty = false, ColumnWidth = 800, IsBold = false, IsItalic = false, IsUnderline = false }
    };
    return Results.Ok(defaultAttributes);
}).RequireRateLimiting("readPolicy");

// 2. Stateless Export Endpoint
app.MapPost("/api/export/{format}", async (
    HttpContext context,
    string format,
    ExportPayload payload,
    ExportRateLimiter rateLimiter,
    ILogger<Program> logger) => 
{
    var normalizedFormat = format?.ToLowerInvariant();
    if (normalizedFormat is not ("docx" or "csv" or "html"))
    {
        return Results.BadRequest(new { error = "Unsupported export format. Use docx, csv, or html." });
    }

    // Rate limiting: shared client budget + format cost
    var clientIp = GetRateLimitPartitionKey(context);
    var rateLimitResult = rateLimiter.CheckAndConsume(clientIp, normalizedFormat);
    if (!rateLimitResult.Allowed)
    {
        logger.LogWarning("Rate limit exceeded for client {ClientIp} on format {Format}. WaitSeconds: {RetryAfter}",
            clientIp, normalizedFormat, rateLimitResult.RetryAfterSeconds);
        context.Response.Headers.RetryAfter = rateLimitResult.RetryAfterSeconds.ToString(CultureInfo.InvariantCulture);
        return Results.Problem(
            statusCode: StatusCodes.Status429TooManyRequests,
            detail: rateLimitResult.Reason ?? "Export rate limit exceeded. Please try again later.");
    }

    // Payload validation: caps, scalar-only, anti-injection, anti-prototype pollution
    var validationResult = PayloadValidator.ValidatePayload(payload);
    if (!validationResult.IsValid)
    {
        logger.LogWarning("Export payload validation rejected. ClientIp: {ClientIp}, Format: {Format}, ErrorCode: {ErrorCode}, Columns: {ColumnsCount}, Rows: {RowsCount}",
            clientIp, normalizedFormat, validationResult.ErrorCode, validationResult.ColumnsCount, validationResult.RowsCount);
        return Results.BadRequest(new { error = validationResult.ErrorMessage, code = validationResult.ErrorCode });
    }

    // Concurrency limiting: server overload protection (3 slots, immediate no-wait admission)
    bool slotAcquired = await rateLimiter.TryAcquireConcurrencySlotAsync(TimeSpan.Zero);
    if (!slotAcquired)
    {
        logger.LogWarning("Export concurrency limit reached for client {ClientIp} on format {Format}", clientIp, normalizedFormat);
        context.Response.Headers.RetryAfter = "1";
        return Results.Problem(
            statusCode: StatusCodes.Status429TooManyRequests,
            detail: "Server is busy processing other export requests. Please try again shortly.");
    }

    try
    {
        var attributes = payload.Attributes;
        var data = payload.Products.Select(p => p.Attributes).ToList();

        IDocumentGenerator generator = normalizedFormat switch
        {
            "docx" => new DocxGenerator(),
            "csv" => new CsvGenerator(),
            "html" => new HtmlGenerator(),
            _ => throw new InvalidOperationException()
        };

        string contentType = normalizedFormat switch
        {
            "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "csv" => "text/csv",
            "html" => "text/html",
            _ => throw new InvalidOperationException()
        };

        var sw = System.Diagnostics.Stopwatch.StartNew();
        var fileBytes = generator.GenerateDocument(data, attributes);
        sw.Stop();

        logger.LogInformation(
            "Export completed: Format={Format}, ClientIp={ClientIp}, DurationMs={DurationMs}, Rows={Rows}, Columns={Columns}, OutputBytes={OutputBytes}",
            normalizedFormat, clientIp, sw.ElapsedMilliseconds, payload.Products.Count, payload.Attributes.Count, fileBytes.Length);

        var fileName = $"inventory_{DateTime.UtcNow:yyyyMMdd_HHmmss}.{normalizedFormat}";
        return Results.File(fileBytes, contentType, fileName);
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Failed to generate {Format} document for client {ClientIp}", normalizedFormat, clientIp);
        return Results.Problem(
            statusCode: StatusCodes.Status500InternalServerError,
            detail: "Failed to generate document.");
    }
    finally
    {
        rateLimiter.ReleaseConcurrencySlot();
    }
});

app.Run();

public partial class Program { }
