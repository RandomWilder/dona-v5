# Node 24 strips TypeScript natively, so there is no build step to stage.
# Debian slim over alpine: glibc avoids musl surprises. Four runtime dependencies since slice 1.4 --
# fastify, pg, pdfjs-dist and google-auth-library -- and pdfjs-dist alone is ~35 MB unpacked, so the
# alpine saving is small against what npm ci --omit=dev already installs.
FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first, so a source-only change reuses this layer.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

USER node
EXPOSE 8080
CMD ["node", "src/serve.ts"]
