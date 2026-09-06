# Build stage
FROM mcr.microsoft.com/dotnet/sdk:8.0@sha256:bb32ba3ba3ea36e38572d9d8db76fa15f7cbf722f3f886e06bca6d528bd4fba8 AS build
WORKDIR /src
COPY ["inventory-generator.csproj", "./"]
RUN dotnet restore "inventory-generator.csproj"
COPY . .
RUN dotnet publish "inventory-generator.csproj" -c Release -o /app/publish /p:UseAppHost=false

# Final runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:8.0@sha256:787c228ea85457bec43c8b084e6ac360b26ea43b5c2fcbe861f721f2e8670dd3 AS final
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/publish .

ARG RELEASE_REVISION=development
LABEL org.opencontainers.image.title="Inventory Generator" \
      org.opencontainers.image.source="https://github.com/SzczepanGrela/inventory-generator" \
      org.opencontainers.image.revision="${RELEASE_REVISION}"

ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_HTTP_PORTS=8080 \
    RELEASE_REVISION="${RELEASE_REVISION}"

USER $APP_UID
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=5s --start-period=5s --retries=10 \
    CMD ["curl", "--fail", "--silent", "--show-error", "--max-time", "4", "http://127.0.0.1:8080/api/health"]
STOPSIGNAL SIGTERM

ENTRYPOINT ["dotnet", "inventory-generator.dll"]
