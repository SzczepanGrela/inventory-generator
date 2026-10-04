using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading.Tasks;
using FluentAssertions;
using Xunit;

namespace InventoryGenerator.IntegrationTests
{
    public class RealKestrelFixture : IAsyncLifetime
    {
        private Process? _process;
        public int Port { get; } = 5298;
        public string BaseUrl => $"http://127.0.0.1:{Port}";

        public async Task InitializeAsync()
        {
            var dllPath = Path.Combine(AppContext.BaseDirectory, "inventory-generator.dll");
            if (!File.Exists(dllPath))
            {
                dllPath = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "bin", "Debug", "net10.0", "inventory-generator.dll"));
            }

            var psi = new ProcessStartInfo("dotnet", $"\"{dllPath}\" --urls {BaseUrl}")
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            _process = Process.Start(psi);

            using var httpClient = new HttpClient();
            var deadline = DateTime.UtcNow.AddSeconds(10);
            while (DateTime.UtcNow < deadline)
            {
                try
                {
                    var res = await httpClient.GetAsync($"{BaseUrl}/api/health");
                    if (res.IsSuccessStatusCode)
                    {
                        return;
                    }
                }
                catch
                {
                    await Task.Delay(100);
                }
            }

            throw new TimeoutException($"Real Kestrel server did not start in time on {BaseUrl}");
        }

        public Task DisposeAsync()
        {
            if (_process != null && !_process.HasExited)
            {
                try
                {
                    _process.Kill(entireProcessTree: true);
                    _process.Dispose();
                }
                catch { }
            }
            return Task.CompletedTask;
        }
    }

    public class RealKestrelStreamedRegressionTests : IClassFixture<RealKestrelFixture>
    {
        private readonly RealKestrelFixture _fixture;

        public RealKestrelStreamedRegressionTests(RealKestrelFixture fixture)
        {
            _fixture = fixture;
        }

        [Fact]
        public async Task RealKestrel_ChunkedBodyExceeding2MB_Returns413OverTcpSocket()
        {
            using var handler = new SocketsHttpHandler();
            using var client = new HttpClient(handler);

            var totalBytes = (2 * 1024 * 1024) + 4096; // Exceeds 2 MiB
            var stream = new RepeatingByteStream((byte)' ', totalBytes);
            using var content = new StreamContent(stream);
            content.Headers.ContentType = new MediaTypeHeaderValue("application/json");

            var request = new HttpRequestMessage(HttpMethod.Post, $"{_fixture.BaseUrl}/api/export/csv")
            {
                Content = content
            };

            var response = await client.SendAsync(request);

            // Real Kestrel TCP socket returns 413 Payload Too Large
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
