using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace InventoryGenerator.Api.Services
{
    public record RateLimitResult(bool Allowed, int RetryAfterSeconds, string? Reason = null);

    public class ExportRateLimiter
    {
        private class ClientBucket
        {
            public double SharedTokens { get; set; }
            public DateTime SharedUpdatedAt { get; set; }
            public double DocxTokens { get; set; }
            public DateTime DocxUpdatedAt { get; set; }
        }

        private readonly double _sharedCapacity;
        private readonly double _sharedRefillPerSecond;
        private readonly double _docxCapacity;
        private readonly double _docxRefillPerSecond;
        private readonly SemaphoreSlim _concurrencySemaphore;
        private readonly Dictionary<string, ClientBucket> _clients = new(StringComparer.OrdinalIgnoreCase);
        private readonly object _lock = new();
        private readonly Func<DateTime> _getUtcNow;
        private DateTime _lastCleanup;

        public ExportRateLimiter(
            int maxConcurrency = 3,
            double sharedCapacity = 10,
            double sharedRefillPerSecond = 10.0 / 60.0,
            double docxCapacity = 2,
            double docxRefillPerSecond = 5.0 / 60.0,
            Func<DateTime>? utcNowProvider = null)
        {
            _sharedCapacity = sharedCapacity;
            _sharedRefillPerSecond = sharedRefillPerSecond;
            _docxCapacity = docxCapacity;
            _docxRefillPerSecond = docxRefillPerSecond;
            _concurrencySemaphore = new SemaphoreSlim(maxConcurrency, maxConcurrency);
            _getUtcNow = utcNowProvider ?? (() => DateTime.UtcNow);
            _lastCleanup = _getUtcNow();
        }

        public RateLimitResult CheckAndConsume(string clientKey, string format)
        {
            var now = _getUtcNow();
            bool isDocx = string.Equals(format, "docx", StringComparison.OrdinalIgnoreCase);
            double sharedCost = isDocx ? 2.0 : 1.0;
            double docxCost = isDocx ? 1.0 : 0.0;

            lock (_lock)
            {
                CleanupIdleBuckets(now);

                if (!_clients.TryGetValue(clientKey, out var bucket))
                {
                    bucket = new ClientBucket
                    {
                        SharedTokens = _sharedCapacity,
                        SharedUpdatedAt = now,
                        DocxTokens = _docxCapacity,
                        DocxUpdatedAt = now
                    };
                    _clients[clientKey] = bucket;
                }
                else
                {
                    // Refill shared
                    var elapsedShared = (now - bucket.SharedUpdatedAt).TotalSeconds;
                    if (elapsedShared > 0)
                    {
                        bucket.SharedTokens = Math.Min(_sharedCapacity, bucket.SharedTokens + elapsedShared * _sharedRefillPerSecond);
                        bucket.SharedUpdatedAt = now;
                    }

                    // Refill docx
                    var elapsedDocx = (now - bucket.DocxUpdatedAt).TotalSeconds;
                    if (elapsedDocx > 0)
                    {
                        bucket.DocxTokens = Math.Min(_docxCapacity, bucket.DocxTokens + elapsedDocx * _docxRefillPerSecond);
                        bucket.DocxUpdatedAt = now;
                    }
                }

                bool sharedAvailable = bucket.SharedTokens >= sharedCost;
                bool docxAvailable = !isDocx || (bucket.DocxTokens >= docxCost);

                if (!sharedAvailable || !docxAvailable)
                {
                    int sharedWait = sharedAvailable
                        ? 0
                        : (int)Math.Ceiling((sharedCost - bucket.SharedTokens) / _sharedRefillPerSecond);

                    int docxWait = docxAvailable
                        ? 0
                        : (int)Math.Ceiling((docxCost - bucket.DocxTokens) / _docxRefillPerSecond);

                    int retryAfter = Math.Max(1, Math.Max(sharedWait, docxWait));

                    string reason = !sharedAvailable
                        ? "Export budget exceeded. A shared rate limit applies across export formats."
                        : "DOCX burst limit exceeded. Please wait before generating another DOCX.";

                    return new RateLimitResult(false, retryAfter, reason);
                }

                // Consume tokens
                bucket.SharedTokens -= sharedCost;
                if (isDocx)
                {
                    bucket.DocxTokens -= docxCost;
                }

                return new RateLimitResult(true, 0);
            }
        }

        public async Task<bool> TryAcquireConcurrencySlotAsync(TimeSpan timeout = default, CancellationToken cancellationToken = default)
        {
            return await _concurrencySemaphore.WaitAsync(timeout, cancellationToken);
        }

        public void ReleaseConcurrencySlot()
        {
            try
            {
                _concurrencySemaphore.Release();
            }
            catch (SemaphoreFullException)
            {
                // Concurrency semaphore is already at max capacity
            }
        }

        private void CleanupIdleBuckets(DateTime now)
        {
            if ((now - _lastCleanup).TotalSeconds < 60.0)
            {
                return;
            }

            var toRemove = new List<string>();
            foreach (var (key, bucket) in _clients)
            {
                var sharedTokens = Math.Min(_sharedCapacity, bucket.SharedTokens + (now - bucket.SharedUpdatedAt).TotalSeconds * _sharedRefillPerSecond);
                var docxTokens = Math.Min(_docxCapacity, bucket.DocxTokens + (now - bucket.DocxUpdatedAt).TotalSeconds * _docxRefillPerSecond);

                if (sharedTokens >= _sharedCapacity && docxTokens >= _docxCapacity)
                {
                    toRemove.Add(key);
                }
            }

            foreach (var key in toRemove)
            {
                _clients.Remove(key);
            }

            _lastCleanup = now;
        }
    }
}
