using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace InventoryGenerator.IntegrationTests.Api
{
    public class SecurityHeadersTests : IClassFixture<WebApplicationFactory<Program>>
    {
        private readonly WebApplicationFactory<Program> _factory;

        public SecurityHeadersTests(WebApplicationFactory<Program> factory)
        {
            _factory = factory;
        }

        [Fact]
        public async Task GetRoot_ShouldReturnStrictSecurityHeaders()
        {
            var client = _factory.CreateClient();

            var response = await client.GetAsync("/");

            response.StatusCode.Should().Be(HttpStatusCode.OK);

            // 1. Content-Security-Policy
            response.Headers.Contains("Content-Security-Policy").Should().BeTrue();
            var csp = string.Join("; ", response.Headers.GetValues("Content-Security-Policy"));
            csp.Should().Contain("default-src 'self'");
            csp.Should().Contain("script-src 'self'");
            csp.Should().Contain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com");
            csp.Should().Contain("font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com");
            csp.Should().Contain("frame-ancestors 'none'");

            // 2. X-Content-Type-Options
            response.Headers.Contains("X-Content-Type-Options").Should().BeTrue();
            string.Join("", response.Headers.GetValues("X-Content-Type-Options")).Should().Be("nosniff");

            // 3. X-Frame-Options
            response.Headers.Contains("X-Frame-Options").Should().BeTrue();
            string.Join("", response.Headers.GetValues("X-Frame-Options")).Should().Be("DENY");

            // 4. Referrer-Policy
            response.Headers.Contains("Referrer-Policy").Should().BeTrue();
            string.Join("", response.Headers.GetValues("Referrer-Policy")).Should().Be("strict-origin-when-cross-origin");

            // 5. Permissions-Policy
            response.Headers.Contains("Permissions-Policy").Should().BeTrue();
        }

        [Fact]
        public async Task GetApiHealth_ShouldIncludeSecurityHeaders()
        {
            var client = _factory.CreateClient();

            var response = await client.GetAsync("/api/health");

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            response.Headers.Contains("Content-Security-Policy").Should().BeTrue();
            response.Headers.Contains("X-Content-Type-Options").Should().BeTrue();
            response.Headers.Contains("X-Frame-Options").Should().BeTrue();
        }
    }
}
