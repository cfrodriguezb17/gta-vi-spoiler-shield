FROM oven/bun:1.4.2
WORKDIR /encoder
COPY shared/model.ts shared/server.ts shared/vector.wasm shared/official-world.json ./
USER bun
ENV EMBED_HOST=::
CMD ["bun","server.ts"]
