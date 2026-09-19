# Builds the API surface of the app for Cloud Run. Vercel deploys the same
# repo separately for pages (see next.config.mjs rewrites + README-Deploy.md);
# this image is only ever addressed on /api/** in production, via the
# Vercel rewrite proxy or Cloud Scheduler hitting it directly.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV DOCKER_BUILD=true
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
USER nextjs
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
