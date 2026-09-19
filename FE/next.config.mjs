let userConfig = undefined
try {
  // try to import ESM first
  userConfig = await import('./v0-user-next.config.mjs')
} catch (e) {
  try {
    // fallback to CJS import
    userConfig = await import("./v0-user-next.config");
  } catch (innerError) {
    // ignore error
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  // Only set for the GCP/Docker build (see Dockerfile) -- Vercel packages the
  // app its own way and doesn't need this output mode.
  ...(process.env.DOCKER_BUILD === 'true' ? { output: 'standalone' } : {}),
  transpilePackages: ['@mcapduel/engine', '@mcapduel/matchmaking', '@mcapduel/points', '@mcapduel/risk'],
  async rewrites() {
    // Set on Vercel, and locally when testing against the real backend.
    // Proxies every /api/* call to the GCP-hosted backend so frontend code
    // keeps calling relative "/api/..." paths unchanged -- Vercel serves
    // pages, GCP Cloud Run serves the API. Unset in local dev when you want
    // this app's own /api routes to serve directly against Anvil/local Mongo
    // instead, and in the GCP deployment itself.
    //
    // Must be beforeFiles: this app still has its own app/api/** route
    // files on disk (leftover from before the BE/FE split), and a plain
    // array here is an "afterFiles" rewrite -- it only applies when no
    // filesystem route already matches, so those local routes would always
    // win and silently swallow BACKEND_API_URL. beforeFiles intercepts
    // ahead of the filesystem check so the proxy always wins when set.
    if (!process.env.BACKEND_API_URL) return []
    return {
      beforeFiles: [
        {
          source: '/api/:path*',
          destination: `${process.env.BACKEND_API_URL}/api/:path*`,
        },
      ],
    }
  },
  eslint: {
    // No ESLint config exists in this project yet (no .eslintrc/eslint.config.*,
    // eslint isn't even a dependency) -- setting one up is a separate decision
    // (rule strictness, likely a pile of first-time findings across the whole
    // app), not a one-line flip. This flag stays true until that's done
    // deliberately; it isn't currently masking any real lint failures.
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
  experimental: {
    webpackBuildWorker: true,
    parallelServerBuildTraces: true,
    parallelServerCompiles: true,
  },
  webpack: (config, { webpack }) => {
    // The linked @mcapduel/* packages are NodeNext ESM: their relative
    // imports use a ".js" extension that actually resolves to sibling ".ts"
    // files (tsc understands this; webpack needs to be told explicitly).
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias || {}),
      '.js': ['.ts', '.tsx', '.js'],
    }
    // @coinbase/cdp-sdk (pulled in transitively by wagmi's Base Account
    // connector, itself pulled in by @privy-io/wagmi) references a couple
    // dozen x402 payment-protocol subpackages that aren't published/
    // installable and aren't needed for wallet connect/sign-in -- this app
    // never calls into Coinbase's x402 payment code. Ignoring the whole
    // "@x402/*" family unblocks module resolution without chasing an
    // ever-growing list of exact subpaths.
    config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^@x402\// }))
    // @metamask/sdk (pulled in by @wagmi/connectors' metaMask connector, itself
    // pulled in by @privy-io/wagmi) conditionally requires the React Native
    // async-storage package for its RN persistence layer. That branch never
    // runs in a browser build, but webpack still tries to resolve it statically.
    config.plugins.push(
      new webpack.IgnorePlugin({ resourceRegExp: /^@react-native-async-storage\/async-storage$/ })
    )
    // viem's chain barrel (config/wagmiConfig.ts's `import { foundry, ... } from
    // 'viem/chains'`, lib/chainVerify.ts's single-chain import) transitively
    // includes viem's "tempo" chain support, whose ox dependency does
    // `await import(someVariable)` to lazily load node:worker_threads -- a
    // dynamic request webpack can't statically bundle ("Critical dependency:
    // the request of a dependency is an expression"). That alone is just a
    // warning, but it corrupts the chunk graph badly enough to crash static
    // prerendering ("Cannot read properties of undefined (reading 'call')")
    // -- and non-deterministically, since this repo's parallel webpack build
    // workers (experimental.webpackBuildWorker etc. below) race on which
    // worker compiles the broken chunk. Nothing here ever uses viem's tempo
    // chain (it's Robinhood Chain / Anvil / mainnet / a couple testnets
    // only), so the whole worker-pool machinery is dead weight either way --
    // ignoring it at the module-request level (not just for server bundling)
    // is what actually reaches the client/SSR bundle that was crashing here,
    // unlike excluding it via serverExternalPackages (tried first; doesn't
    // help since this bundle isn't server-only).
    config.plugins.push(
      new webpack.IgnorePlugin({
        checkResource: (resource, context) => /[\\/]ox[\\/]_esm[\\/]tempo[\\/]/.test(context),
      })
    )
    return config
  },
}

if (userConfig) {
  // ESM imports will have a "default" property
  const config = userConfig.default || userConfig

  for (const key in config) {
    if (
      typeof nextConfig[key] === 'object' &&
      !Array.isArray(nextConfig[key])
    ) {
      nextConfig[key] = {
        ...nextConfig[key],
        ...config[key],
      }
    } else {
      nextConfig[key] = config[key]
    }
  }
}

export default nextConfig
