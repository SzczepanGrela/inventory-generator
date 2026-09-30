using System;
using System.Threading.Tasks;
using FluentAssertions;
using InventoryGenerator.Api.Services;
using Xunit;

namespace InventoryGenerator.UnitTests.Services
{
    public class ExportRateLimiterTests
    {
        [Fact]
        public void CheckAndConsume_ShouldAllowUpTo10CsvExports_AndReject11th()
        {
            var limiter = new ExportRateLimiter();
            var clientKey = "192.168.1.100";

            for (int i = 0; i < 10; i++)
            {
                var result = limiter.CheckAndConsume(clientKey, "csv");
                result.Allowed.Should().BeTrue($"CSV export {i + 1} should be allowed");
                result.RetryAfterSeconds.Should().Be(0);
            }

            var rejectedResult = limiter.CheckAndConsume(clientKey, "csv");
            rejectedResult.Allowed.Should().BeFalse("11th CSV export in the same window should be rejected");
            rejectedResult.RetryAfterSeconds.Should().BeGreaterThan(0);
            rejectedResult.Reason.Should().Contain("Export budget exceeded");
        }

        [Fact]
        public void CheckAndConsume_ShouldEnforceDocxBurstOf2()
        {
            var limiter = new ExportRateLimiter();
            var clientKey = "192.168.1.101";

            var first = limiter.CheckAndConsume(clientKey, "docx");
            first.Allowed.Should().BeTrue();

            var second = limiter.CheckAndConsume(clientKey, "docx");
            second.Allowed.Should().BeTrue();

            var third = limiter.CheckAndConsume(clientKey, "docx");
            third.Allowed.Should().BeFalse();
            third.RetryAfterSeconds.Should().BeGreaterThan(0);
            third.Reason.Should().Contain("DOCX burst limit exceeded");
        }

        [Fact]
        public void CheckAndConsume_ShouldEnforceSharedBudgetAcrossFormats()
        {
            var limiter = new ExportRateLimiter();
            var clientKey = "192.168.1.102";

            // 5 CSV = 5 shared units
            for (int i = 0; i < 5; i++)
            {
                limiter.CheckAndConsume(clientKey, "csv").Allowed.Should().BeTrue();
            }

            // 2 DOCX = 4 shared units (total 9 units)
            limiter.CheckAndConsume(clientKey, "docx").Allowed.Should().BeTrue();
            limiter.CheckAndConsume(clientKey, "docx").Allowed.Should().BeTrue();

            // 1 HTML = 1 shared unit (total 10 units)
            limiter.CheckAndConsume(clientKey, "html").Allowed.Should().BeTrue();

            // Budget exhausted (10/10 units)
            // Even though client wants CSV (cost 1), shared budget is 0
            var csvResult = limiter.CheckAndConsume(clientKey, "csv");
            csvResult.Allowed.Should().BeFalse();
            csvResult.RetryAfterSeconds.Should().BeGreaterThan(0);
        }

        [Fact]
        public void CheckAndConsume_ShouldIsolateDifferentClients()
        {
            var limiter = new ExportRateLimiter();
            var client1 = "10.0.0.1";
            var client2 = "10.0.0.2";

            for (int i = 0; i < 10; i++)
            {
                limiter.CheckAndConsume(client1, "csv").Allowed.Should().BeTrue();
            }

            // Client 1 is exhausted
            limiter.CheckAndConsume(client1, "csv").Allowed.Should().BeFalse();

            // Client 2 is fresh and independent
            limiter.CheckAndConsume(client2, "csv").Allowed.Should().BeTrue();
        }

        [Fact]
        public void CheckAndConsume_ShouldRefillOverTime()
        {
            DateTime fakeNow = new DateTime(2026, 9, 30, 12, 0, 0, DateTimeKind.Utc);
            var limiter = new ExportRateLimiter(utcNowProvider: () => fakeNow);
            var clientKey = "192.168.1.103";

            for (int i = 0; i < 10; i++)
            {
                limiter.CheckAndConsume(clientKey, "csv").Allowed.Should().BeTrue();
            }

            limiter.CheckAndConsume(clientKey, "csv").Allowed.Should().BeFalse();

            // Advance time by 60 seconds (full refill of 10 tokens)
            fakeNow = fakeNow.AddSeconds(60);

            limiter.CheckAndConsume(clientKey, "csv").Allowed.Should().BeTrue();
        }

        [Fact]
        public async Task ConcurrencySlot_ShouldEnforceConcurrencyCap()
        {
            var limiter = new ExportRateLimiter(maxConcurrency: 3);

            var slot1 = await limiter.TryAcquireConcurrencySlotAsync(TimeSpan.Zero);
            var slot2 = await limiter.TryAcquireConcurrencySlotAsync(TimeSpan.Zero);
            var slot3 = await limiter.TryAcquireConcurrencySlotAsync(TimeSpan.Zero);

            slot1.Should().BeTrue();
            slot2.Should().BeTrue();
            slot3.Should().BeTrue();

            // 4th concurrent attempt should fail
            var slot4 = await limiter.TryAcquireConcurrencySlotAsync(TimeSpan.Zero);
            slot4.Should().BeFalse();

            // Releasing one slot allows another acquisition
            limiter.ReleaseConcurrencySlot();
            var slot5 = await limiter.TryAcquireConcurrencySlotAsync(TimeSpan.Zero);
            slot5.Should().BeTrue();

            limiter.ReleaseConcurrencySlot();
            limiter.ReleaseConcurrencySlot();
            limiter.ReleaseConcurrencySlot();
        }
    }
}
