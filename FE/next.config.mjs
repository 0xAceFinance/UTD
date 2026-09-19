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
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,OPTIONS,PATCH,DELETE,POST,PUT' },
          { key: 'Access-Control-Allow-Headers', value: 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, x-admin-secret' },
        ],
      },
    ]
  },
  async rewrites() {
    // When running as the backend container on GCP, serve API routes natively without rewriting
    if (process.env.DOCKER_BUILD === 'true') return []

    // When running on Vercel or frontend host, proxy /api/* beforeFiles to GCP Cloud Run
    const backendUrl = process.env.BACKEND_API_URL || 'https://utd-backend-998336196389.us-central1.run.app'
    return {
      beforeFiles: [
        {
          source: '/api/:path*',
          destination: `${backendUrl}/api/:path*`,
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
