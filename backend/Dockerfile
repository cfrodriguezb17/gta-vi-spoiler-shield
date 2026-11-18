FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY Shield.csproj .
RUN dotnet restore
COPY . .
COPY --from=world official-world.json /shared/official-world.json
RUN dotnet publish -c Release --no-restore -o /app
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
USER app
ENTRYPOINT ["dotnet","Shield.dll"]
