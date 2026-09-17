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
  async redirects() {
    return [
      {
        source: '/',
        destination: '/landing',
        permanent: false,
      },
    ]
  },
  transpilePackages: ['@mcapduel/engine', '@mcapduel/matchmaking', '@mcapduel/points', '@mcapduel/risk'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
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
