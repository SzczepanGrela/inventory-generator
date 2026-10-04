using Microsoft.AspNetCore.Hosting;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Xunit;

namespace InventoryGenerator.IntegrationTests
{
    public class ExportValidationLoggingTests : IClassFixture<WebApplicationFactory<Program>>
    {
        private readonly WebApplicationFactory<Program> _factory;

        public ExportValidationLoggingTests(WebApplicationFactory<Program> factory)
        {
            _factory = factory;
        }

        [Fact]
        public async Task Export_WithInvalidAttributeType_ShouldNotLogUntrustedColumnNamesOrKeys()
        {
            var logSink = new TestLogSink();
            var client = _factory.WithWebHostBuilder(builder =>
            {
                builder.ConfigureLogging(logging =>
                {
                    logging.AddProvider(new TestLoggerProvider(logSink));
                });
            }).CreateClient();

            string syntheticColumnName = "SENSITIVE_PII_PESEL_999999999";
            string syntheticKey = "UNTRUSTED_INTERNAL_KEY_888888";

            var json = $$"""
            {
                "attributes": [
                    { "name": "{{syntheticColumnName}}", "type": 9999 }
                ],
                "products": [
                    {
                        "id": 1,
                        "attributes": {
                            "{{syntheticKey}}": "valid"
                        }
                    }
                ]
            }
            """;

            var response = await client.PostAsync("/api/export/csv", new StringContent(json, Encoding.UTF8, "application/json"));
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

            var logs = logSink.Logs.ToArray();
            logs.Should().Contain(l => l.Contains("Export payload validation rejected"));
            logs.Should().Contain(l => l.Contains("INVALID_ATTRIBUTE_TYPE"));

            // IC03-3: Crucial verification - payload text, column names, and keys must NEVER be logged
            logs.Should().NotContain(l => l.Contains(syntheticColumnName));
            logs.Should().NotContain(l => l.Contains(syntheticKey));
        }

        [Fact]
        public async Task Export_WithDuplicateColumnName_ShouldNotLogColumnName()
        {
            var logSink = new TestLogSink();
            var client = _factory.WithWebHostBuilder(builder =>
            {
                builder.ConfigureLogging(logging =>
                {
                    logging.AddProvider(new TestLoggerProvider(logSink));
                });
            }).CreateClient();

            string duplicateColumn = "PROPRIETARY_USER_HEADER_NAME_X";

            var json = $$"""
            {
                "attributes": [
                    { "name": "{{duplicateColumn}}", "type": 0 },
                    { "name": "{{duplicateColumn}}", "type": 0 }
                ],
                "products": []
            }
            """;

            var response = await client.PostAsync("/api/export/csv", new StringContent(json, Encoding.UTF8, "application/json"));
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

            var logs = logSink.Logs.ToArray();
            logs.Should().Contain(l => l.Contains("DUPLICATE_ATTRIBUTE_NAME"));
            logs.Should().NotContain(l => l.Contains(duplicateColumn));
        }

        [Fact]
        public async Task Export_WithInvalidValueType_ShouldNotLogAttributeKey()
        {
            var logSink = new TestLogSink();
            var client = _factory.WithWebHostBuilder(builder =>
            {
                builder.ConfigureLogging(logging =>
                {
                    logging.AddProvider(new TestLoggerProvider(logSink));
                });
            }).CreateClient();

            string secretKey = "SECRET_CREDIT_CARD_HASH_12345";

            var json = $$"""
            {
                "attributes": [
                    { "name": "Column1", "type": 0 }
                ],
                "products": [
                    {
                        "id": 1,
                        "attributes": {
                            "{{secretKey}}": { "nested": "object" }
                        }
                    }
                ]
            }
            """;

            var response = await client.PostAsync("/api/export/csv", new StringContent(json, Encoding.UTF8, "application/json"));
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

            var logs = logSink.Logs.ToArray();
            logs.Should().Contain(l => l.Contains("INVALID_ATTRIBUTE_VALUE_TYPE"));
            logs.Should().NotContain(l => l.Contains(secretKey));
        }

        private class TestLogSink
        {
            public ConcurrentBag<string> Logs { get; } = new();
        }

        private class TestLoggerProvider : ILoggerProvider
        {
            private readonly TestLogSink _sink;

            public TestLoggerProvider(TestLogSink sink) => _sink = sink;

            public ILogger CreateLogger(string categoryName) => new TestLogger(_sink);

            public void Dispose() { }
        }

        private class TestLogger : ILogger
        {
            private readonly TestLogSink _sink;

            public TestLogger(TestLogSink sink) => _sink = sink;

            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            {
                _sink.Logs.Add(formatter(state, exception));
            }
        }
    }
}
