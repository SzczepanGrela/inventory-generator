using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
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
            // Arrange
            var client = _factory.CreateClient();
            var payload = new ExportPayload
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

            // Act
            var response = await client.PostAsJsonAsync("/api/export/html", payload);

            // Assert
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

            for (var request = 0; request < 30; request++)
            {
                using var response = await firstClient.PostAsJsonAsync("/api/export/html", payload);
                response.StatusCode.Should().Be(HttpStatusCode.OK);
            }

            using var limitedResponse = await firstClient.PostAsJsonAsync("/api/export/html", payload);
            limitedResponse.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);

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

            for (var request = 0; request < 30; request++)
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
