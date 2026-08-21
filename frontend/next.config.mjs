/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://127.0.0.1:3030/api/:path*', // Proxy to backend
      },
    ];
  },
};

export default nextConfig;
