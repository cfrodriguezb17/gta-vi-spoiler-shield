FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src/backend
COPY backend/Shield.csproj .
RUN dotnet restore
COPY backend/*.cs backend/appsettings.json backend/schema.sql ./
COPY shared/official-world.json /src/shared/official-world.json
RUN dotnet publish -c Release --no-restore -o /app
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
COPY backend/revision.txt .
USER app
ENTRYPOINT ["dotnet","Shield.dll"]
