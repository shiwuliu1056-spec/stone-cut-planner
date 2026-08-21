/** @type {import('next').NextConfig} */
const nextConfig = {
  // 开发服务器默认只允许 localhost；本项目由后端绑定 127.0.0.1，
  // 需要显式允许该来源加载 Next.js 的开发资源。
  allowedDevOrigins: ['127.0.0.1'],
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
