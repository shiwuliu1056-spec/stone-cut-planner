/** @type {import('next').NextConfig} */
const win8Build = process.env.NEXT_WIN8_BUILD === '1';

const nextConfig = {
  // Win8 绿色版在运行时不加载 Next.js，而是由 Node 14 的原生 HTTP
  // 服务托管这个静态导出目录。普通开发/生产流程仍使用默认 Next 输出。
  ...(win8Build ? { output: 'export' } : {}),
  // 开发服务器默认只允许 localhost；本项目由后端绑定 127.0.0.1，
  // 需要显式允许该来源加载 Next.js 的开发资源。
  allowedDevOrigins: ['127.0.0.1'],
  // 静态导出不支持 rewrites；兼容包与 API 共用同一端口，也不需要代理。
  ...(win8Build ? {} : {
    async rewrites() {
      return [
        {
          source: '/api/:path*',
          destination: 'http://127.0.0.1:3030/api/:path*', // Proxy to backend
        },
      ];
    },
  }),
};

export default nextConfig;
