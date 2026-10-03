using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace InventoryGenerator.IntegrationTests
{
    public class NullSafetyTests : IClassFixture<WebApplicationFactory<Program>>
    {
        private readonly WebApplicationFactory<Program> _factory;

        public NullSafetyTests(WebApplicationFactory<Program> factory)
        {
            _factory = factory;
        }

        [Fact]
        public async Task Export_WithNullAttributeInArray_ShouldReturn400BadRequest()
        {
            var client = _factory.CreateClient();
            var json = """
            {
                "attributes": [null],
                "products": []
            }
            """;
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var response = await client.PostAsync("/api/export/csv", content);

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            var responseBody = await response.Content.ReadAsStringAsync();
            responseBody.Should().Contain("Attribute definition at index 0 cannot be null");
        }

        [Fact]
        public async Task Export_WithNullProductInArray_ShouldReturn400BadRequest()
        {
            var client = _factory.CreateClient();
            var json = """
            {
                "attributes": [
                    { "name": "Column1", "type": "String" }
                ],
                "products": [null]
            }
            """;
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var response = await client.PostAsync("/api/export/csv", content);

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            var responseBody = await response.Content.ReadAsStringAsync();
            responseBody.Should().Contain("Product entry at index 0 cannot be null");
        }

        [Fact]
        public async Task Export_WithNullProductAttributes_ShouldReturn400BadRequest()
        {
            var client = _factory.CreateClient();
            var json = """
            {
                "attributes": [
                    { "name": "Column1", "type": "String" }
                ],
                "products": [
                    { "id": 1, "attributes": null }
                ]
            }
            """;
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var response = await client.PostAsync("/api/export/csv", content);

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            var responseBody = await response.Content.ReadAsStringAsync();
            responseBody.Should().Contain("attributes dictionary cannot be null");
        }

        [Fact]
        public async Task Export_WithInvalidAttributeType_ShouldReturn400BadRequest()
        {
            var client = _factory.CreateClient();
            var json = """
            {
                "attributes": [
                    { "name": "Column1", "type": "NonExistentType99" }
                ],
                "products": []
            }
            """;
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var response = await client.PostAsync("/api/export/csv", content);

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        [Fact]
        public async Task Export_WithOutOfRangeColumnWidth_ShouldReturn400BadRequest()
        {
            var client = _factory.CreateClient();
            var json = """
            {
                "attributes": [
                    { "name": "Column1", "type": "String", "columnWidth": 10 }
                ],
                "products": []
            }
            """;
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var response = await client.PostAsync("/api/export/csv", content);

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            var responseBody = await response.Content.ReadAsStringAsync();
            responseBody.Should().Contain("column width must be between 50 and 5000");
        }

        [Fact]
        public async Task Export_WithEnumMissingValues_ShouldReturn400BadRequest()
        {
            var client = _factory.CreateClient();
            var json = """
            {
                "attributes": [
                    { "name": "Category", "type": "Enum", "enumValues": [] }
                ],
                "products": []
            }
            """;
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var response = await client.PostAsync("/api/export/csv", content);

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            var responseBody = await response.Content.ReadAsStringAsync();
            responseBody.Should().Contain("must contain at least one enum value");
        }

        [Fact]
        public async Task Export_WithEmptyAttributeKeyInProduct_ShouldReturn400BadRequest()
        {
            var client = _factory.CreateClient();
            var json = """
            {
                "attributes": [
                    { "name": "Col1", "type": "String" }
                ],
                "products": [
                    {
                        "id": 1,
                        "attributes": {
                            "   ": "value"
                        }
                    }
                ]
            }
            """;
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var response = await client.PostAsync("/api/export/csv", content);

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            var responseBody = await response.Content.ReadAsStringAsync();
            responseBody.Should().Contain("empty or whitespace attribute key");
        }

        [Fact]
        public async Task Export_WithValidEmptyProducts_ShouldReturn200OK()
        {
            var client = _factory.CreateClient();
            var json = """
            {
                "attributes": [
                    { "name": "Column1", "type": "String" }
                ],
                "products": []
            }
            """;
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var response = await client.PostAsync("/api/export/csv", content);

            response.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task Export_WithBodyExceeding2MB_ShouldReturn413PayloadTooLarge()
        {
            var client = _factory.CreateClient();
            // Payload larger than 2MB
            var largeString = new string('A', 2 * 1024 * 1024 + 100);
            var json = $"{{\"attributes\":[{{\"name\":\"Col1\",\"type\":\"String\"}}],\"products\":[{{\"id\":1,\"attributes\":{{\"Col1\":\"{largeString}\"}}}}]}}";
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var response = await client.PostAsync("/api/export/csv", content);

            response.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);
        }

        [Fact]
        public async Task Export_WithChunkedStreamExceeding2MB_ShouldReturn413PayloadTooLarge()
        {
            var client = _factory.CreateClient();

            // Create a StreamContent with chunked transfer-encoding (no Content-Length header)
            var totalBytes = (2 * 1024 * 1024) + 1024;
            var stream = new RepeatingByteStream((byte)' ', totalBytes);
            using var content = new StreamContent(stream);
            content.Headers.ContentType = new MediaTypeHeaderValue("application/json");

            var request = new HttpRequestMessage(HttpMethod.Post, "/api/export/csv")
            {
                Content = content
            };

            var response = await client.SendAsync(request);

            response.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);
        }

        private sealed class RepeatingByteStream : Stream
        {
            private readonly byte _byteVal;
            private readonly long _length;
            private long _position;

            public RepeatingByteStream(byte byteVal, long length)
            {
                _byteVal = byteVal;
                _length = length;
            }

            public override bool CanRead => true;
            public override bool CanSeek => false;
            public override bool CanWrite => false;
            public override long Length => _length;
            public override long Position
            {
                get => _position;
                set => throw new NotSupportedException();
            }

            public override int Read(byte[] buffer, int offset, int count)
            {
                if (_position >= _length) return 0;
                var toRead = (int)Math.Min(count, _length - _position);
                Array.Fill(buffer, _byteVal, offset, toRead);
                _position += toRead;
                return toRead;
            }

            public override void Flush() { }
            public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
            public override void SetLength(long value) => throw new NotSupportedException();
            public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        }
    }
}
