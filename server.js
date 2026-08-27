#!/usr/bin/env node
'use strict';

// 保留旧版 BAT 的 `node.exe server.js` 入口，不加载 Next.js。
require('./backend/legacy-server');
