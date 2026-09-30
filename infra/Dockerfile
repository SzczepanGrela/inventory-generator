# Build stage
FROM mcr.microsoft.com/dotnet/sdk:10.0@sha256:35d40304542c8689331f8cab17c65926cdf48fe711e289321d71924b230a7d29 AS build
WORKDIR /src
COPY ["inventory-generator.csproj", "./"]
RUN dotnet restore "inventory-generator.csproj"
COPY . .
RUN dotnet publish "inventory-generator.csproj" -c Release -o /app/publish /p:UseAppHost=false

# Final runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:10.0@sha256:2d584d8147faddb0d678c5748d47953e5b8e18621ed4fb7049a91381d9d7746f AS final
WORKDIR /app
RUN apt-get update \
    && apt-get upgrade -y \
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
