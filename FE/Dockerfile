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
# Next.js inlines every NEXT_PUBLIC_* var into the compiled output at `next
# build` time (server AND client bundles alike, since shared modules like
# config/contracts.ts are imported from both) -- it does NOT read them at
# container runtime. `gcloud run deploy --set-env-vars` only configures the
# *deployed revision's* runtime env, which doesn't exist yet during this
# build step, so without these ARGs the values baked in here would silently
# fall back to config/contracts.ts's local-dev defaults (chain 31337, empty
# contract addresses) no matter what --set-env-vars says. Pass the same
# values via --set-build-env-vars (see cloudbuild.yaml / deploy-gcp.yml) so
# they actually reach this RUN step.
ARG NEXT_PUBLIC_CHAIN_ID
ARG NEXT_PUBLIC_RPC_URL
ARG NEXT_PUBLIC_BATTLE_ESCROW_FACTORY_ADDRESS
ARG NEXT_PUBLIC_STAKE_TOKEN_ADDRESS
ARG NEXT_PUBLIC_UTD_X_URL
ARG NEXT_PUBLIC_UTD_TELEGRAM_URL
ARG NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
ENV NEXT_PUBLIC_CHAIN_ID=$NEXT_PUBLIC_CHAIN_ID \
    NEXT_PUBLIC_RPC_URL=$NEXT_PUBLIC_RPC_URL \
    NEXT_PUBLIC_BATTLE_ESCROW_FACTORY_ADDRESS=$NEXT_PUBLIC_BATTLE_ESCROW_FACTORY_ADDRESS \
    NEXT_PUBLIC_STAKE_TOKEN_ADDRESS=$NEXT_PUBLIC_STAKE_TOKEN_ADDRESS \
    NEXT_PUBLIC_UTD_X_URL=$NEXT_PUBLIC_UTD_X_URL \
    NEXT_PUBLIC_UTD_TELEGRAM_URL=$NEXT_PUBLIC_UTD_TELEGRAM_URL \
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=$NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
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
