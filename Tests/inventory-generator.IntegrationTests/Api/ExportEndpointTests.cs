using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Xunit;
using InventoryGenerator.Api.Models;

namespace InventoryGenerator.IntegrationTests.Api
{
    public class ExportEndpointTests : IClassFixture<WebApplicationFactory<Program>>
    {
        private readonly WebApplicationFactory<Program> _factory;

        public ExportEndpointTests(WebApplicationFactory<Program> factory)
        {
            _factory = factory;
        }

        [Fact]
        public async Task GetHealth_ShouldReturnStatusAndRevision()
        {
            var client = _factory.CreateClient();

            var response = await client.GetAsync("/api/health");

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            document.RootElement.GetProperty("status").GetString().Should().Be("ok");
            document.RootElement.GetProperty("revision").GetString().Should().NotBeNullOrWhiteSpace();
        }

        [Fact]
        public async Task PostExportHtml_ShouldReturnFile_WhenPayloadIsValid()
        {
            using var factory = CreateFactory("192.0.2.20");
            var client = CreateProxiedClient(factory, "192.0.2.20", "198.51.100.99");
            var payload = CreatePayload();

            var response = await client.PostAsJsonAsync("/api/export/html", payload);

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            response.Content.Headers.ContentType?.MediaType.Should().Be("text/html");
            var content = await response.Content.ReadAsStringAsync();
            content.Should().NotBeNullOrEmpty();
            content.Should().Contain("Test Product");
        }

        [Fact]
        public async Task PostExport_ShouldRateLimitEachForwardedClientIndependently()
        {
            using var factory = CreateFactory("192.0.2.20,192.0.2.10");
            var firstClient = CreateProxiedClient(
                factory,
                "192.0.2.20",
                "198.51.100.10, 192.0.2.10");
            var payload = CreatePayload();

            for (var request = 0; request < 10; request++)
            {
                using var response = await firstClient.PostAsJsonAsync("/api/export/html", payload);
                response.StatusCode.Should().Be(HttpStatusCode.OK);
            }

            using var limitedResponse = await firstClient.PostAsJsonAsync("/api/export/html", payload);
            limitedResponse.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
            limitedResponse.Headers.Contains("Retry-After").Should().BeTrue();

            var secondClient = CreateProxiedClient(
                factory,
                "192.0.2.20",
                "198.51.100.11, 192.0.2.10");
            using var independentResponse = await secondClient.PostAsJsonAsync("/api/export/html", payload);
            independentResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task PostExport_ShouldIgnoreForwardedForFromUnknownProxy()
        {
            using var factory = CreateFactory("192.0.2.20,192.0.2.10");
            var firstClient = CreateProxiedClient(
                factory,
                "203.0.113.200",
                "198.51.100.10");
            var payload = CreatePayload();

            for (var request = 0; request < 10; request++)
            {
                using var response = await firstClient.PostAsJsonAsync("/api/export/html", payload);
                response.StatusCode.Should().Be(HttpStatusCode.OK);
            }

            var spoofedClient = CreateProxiedClient(
                factory,
                "203.0.113.200",
                "198.51.100.11");
            using var spoofedResponse = await spoofedClient.PostAsJsonAsync("/api/export/html", payload);
            spoofedResponse.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
            spoofedResponse.Headers.Contains("Retry-After").Should().BeTrue();
        }

        [Fact]
        public async Task PostExport_ShouldEnforceSharedFormatBudget()
        {
            using var factory = CreateFactory("192.0.2.20");
            var client = CreateProxiedClient(factory, "192.0.2.20", "198.51.100.55");
            var payload = CreatePayload();

            // 5 CSV = 5 units
            for (int i = 0; i < 5; i++)
            {
                using var res = await client.PostAsJsonAsync("/api/export/csv", payload);
                res.StatusCode.Should().Be(HttpStatusCode.OK);
            }

            // 2 DOCX = 4 units (total 9 units)
            for (int i = 0; i < 2; i++)
            {
                using var res = await client.PostAsJsonAsync("/api/export/docx", payload);
                res.StatusCode.Should().Be(HttpStatusCode.OK);
            }

            // 1 HTML = 1 unit (total 10 units)
            using var resHtml = await client.PostAsJsonAsync("/api/export/html", payload);
            resHtml.StatusCode.Should().Be(HttpStatusCode.OK);

            // 11th unit equivalent (shared budget exhausted)
            using var blockedRes = await client.PostAsJsonAsync("/api/export/csv", payload);
            blockedRes.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
            blockedRes.Headers.Contains("Retry-After").Should().BeTrue();
        }

        [Fact]
        public async Task PostExport_ShouldEnforceDocxBurstOf2()
        {
            using var factory = CreateFactory("192.0.2.20");
            var client = CreateProxiedClient(factory, "192.0.2.20", "198.51.100.77");
            var payload = CreatePayload();

            using var docx1 = await client.PostAsJsonAsync("/api/export/docx", payload);
            docx1.StatusCode.Should().Be(HttpStatusCode.OK);

            using var docx2 = await client.PostAsJsonAsync("/api/export/docx", payload);
            docx2.StatusCode.Should().Be(HttpStatusCode.OK);

            using var docx3 = await client.PostAsJsonAsync("/api/export/docx", payload);
            docx3.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
            docx3.Headers.Contains("Retry-After").Should().BeTrue();
        }

        [Fact]
        public async Task PostExport_ShouldReturn413_WhenContentLengthExceeds2MB()
        {
            using var factory = CreateFactory("192.0.2.20");
            var client = CreateProxiedClient(factory, "192.0.2.20", "198.51.100.88");

            var request = new HttpRequestMessage(HttpMethod.Post, "/api/export/csv");
            request.Content = new StringContent("{}", Encoding.UTF8, "application/json");
            request.Content.Headers.ContentLength = 2 * 1024 * 1024 + 1; // 2MB + 1 byte

            var response = await client.SendAsync(request);
            response.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);
        }

        [Fact]
        public async Task PostExport_ShouldReturn400_WhenPayloadContainsNestedJson()
        {
            using var factory = CreateFactory("192.0.2.20");
            var client = CreateProxiedClient(factory, "192.0.2.20", "198.51.100.90");

            var rawJson = @"{
                ""attributes"": [{ ""name"": ""Col1"", ""type"": ""String"" }],
                ""products"": [
                    {
                        ""id"": 1,
                        ""attributes"": {
                            ""Col1"": { ""maliciousNested"": true }
                        }
                    }
                ]
            }";

            var content = new StringContent(rawJson, Encoding.UTF8, "application/json");
            var response = await client.PostAsync("/api/export/csv", content);

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            var body = await response.Content.ReadAsStringAsync();
            body.Should().Contain("Nested objects and arrays are forbidden");
        }

        [Fact]
        public async Task PostExport_ShouldReturn400_WhenPayloadExceedsColumnLimit()
        {
            using var factory = CreateFactory("192.0.2.20");
            var client = CreateProxiedClient(factory, "192.0.2.20", "198.51.100.91");

            var attributes = new List<ProductAttribute>();
            for (int i = 0; i < 51; i++)
            {
                attributes.Add(new ProductAttribute { Name = $"Col{i}", Type = AttributeType.String });
            }

            var payload = new ExportPayload
            {
                Attributes = attributes,
                Products = new List<DynamicProduct>()
            };

            var response = await client.PostAsJsonAsync("/api/export/csv", payload);
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            var body = await response.Content.ReadAsStringAsync();
            body.Should().Contain("maximum allowed columns (50)");
        }

        [Fact]
        public async Task PostExport_ShouldReturn400_WhenMaxDepthExceeded()
        {
            using var factory = CreateFactory("192.0.2.20");
            var client = CreateProxiedClient(factory, "192.0.2.20", "198.51.100.92");

            // Nesting depth > 8
            var deepJson = "{\"a\":{\"b\":{\"c\":{\"d\":{\"e\":{\"f\":{\"g\":{\"h\":{\"i\":1}}}}}}}}}";
            var content = new StringContent(deepJson, Encoding.UTF8, "application/json");

            var response = await client.PostAsync("/api/export/csv", content);
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        private WebApplicationFactory<Program> CreateFactory(string trustedProxyIps)
        {
            return _factory.WithWebHostBuilder(builder =>
            {
                builder.UseSetting("TRUSTED_PROXY_IPS", trustedProxyIps);
                builder.ConfigureServices(services =>
                    services.AddSingleton<IStartupFilter>(new TestRemoteIpStartupFilter()));
            });
        }

        private static HttpClient CreateProxiedClient(
            WebApplicationFactory<Program> factory,
            string remoteIpAddress,
            string forwardedFor)
        {
            var client = factory.CreateClient();
            client.DefaultRequestHeaders.Add("X-Test-Remote-IP", remoteIpAddress);
            client.DefaultRequestHeaders.Add("X-Forwarded-For", forwardedFor);
            return client;
        }

        private static ExportPayload CreatePayload()
        {
            return new ExportPayload
            {
                Attributes = new List<ProductAttribute>
                {
                    new ProductAttribute { Name = "Product Name", Type = AttributeType.String }
                },
                Products = new List<DynamicProduct>
                {
                    new DynamicProduct
                    {
                        Id = 1,
                        Attributes = new Dictionary<string, object?> { { "Product Name", "Test Product" } }
                    }
                }
            };
        }

        private sealed class TestRemoteIpStartupFilter : IStartupFilter
        {
            public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next)
            {
                return app =>
                {
                    app.Use(async (context, nextMiddleware) =>
                    {
                        var testRemoteIp = context.Request.Headers["X-Test-Remote-IP"].ToString();
                        if (IPAddress.TryParse(testRemoteIp, out var address))
                        {
                            context.Connection.RemoteIpAddress = address;
                        }

                        await nextMiddleware();
                    });
                    next(app);
                };
            }
        }
    }
}
