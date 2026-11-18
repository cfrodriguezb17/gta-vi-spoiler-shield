FROM oven/bun:1.4.2
WORKDIR /encoder
COPY model.ts server.ts vector.wasm official-world.json ./
USER bun
ENV EMBED_HOST=0.0.0.0
CMD ["bun","server.ts"]
