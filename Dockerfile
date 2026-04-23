# syntax=docker/dockerfile:1.6

# ---------- Build stage ----------
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
# Ưu tiên npm ci (reproducible); nếu lockfile lệch thì fallback sang npm install
RUN npm ci || npm install

COPY . .
RUN npm run build

# Gỡ devDependencies để chuẩn bị node_modules production-only
RUN npm prune --omit=dev

# ---------- Run stage ----------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# dumb-init để forward signal đúng (graceful shutdown khi docker stop)
# Tạo sẵn các thư mục sẽ được mount volume và gán quyền cho user "node"
RUN apk add --no-cache dumb-init \
 && mkdir -p /app/public/images /app/upload /app/views \
 && chown -R node:node /app

COPY --chown=node:node --from=builder /app/package*.json ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/public ./public
COPY --chown=node:node --from=builder /app/views ./views
# Mail templates (.hbs) không được nest build copy sang dist, phải copy tay
COPY --chown=node:node --from=builder /app/src/mail/templates ./dist/mail/templates

USER node

EXPOSE 3000
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
