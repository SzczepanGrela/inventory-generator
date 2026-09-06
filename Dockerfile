# Build stage
FROM mcr.microsoft.com/dotnet/sdk:10.0@sha256:e1ffd2a92ae84c1291bc1b6887501f8af98e6331e7af6d4c8d37168c5e87a64c AS build
WORKDIR /src
COPY ["inventory-generator.csproj", "./"]
RUN dotnet restore "inventory-generator.csproj"
COPY . .
RUN dotnet publish "inventory-generator.csproj" -c Release -o /app/publish /p:UseAppHost=false

# Final runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:8.0@sha256:787c228ea85457bec43c8b084e6ac360b26ea43b5c2fcbe861f721f2e8670dd3 AS final
WORKDIR /app
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
STOPSIGNAL SIGTERM

ENTRYPOINT ["dotnet", "inventory-generator.dll"]
