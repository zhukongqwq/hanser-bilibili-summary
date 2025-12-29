#!/bin/bash

# 颜色定义
GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${GREEN}=== 开始部署 Bilibili Hanser 浓度分析工具 ===${NC}"

# 1. 检查核心文件是否存在
if [ ! -f "server.js" ]; then
    echo "错误：未找到 server.js！请先将代码上传到当前目录。"
    exit 1
fi

# 2. 检查 Docker 环境
if ! command -v docker &> /dev/null; then
    echo "Docker 未安装，正在尝试自动安装..."
    curl -fsSL https://get.docker.com | bash -s docker --mirror Aliyun
    systemctl enable docker
    systemctl start docker
fi

if ! command -v docker-compose &> /dev/null; then
    echo "正在安装 Docker Compose..."
    # 尝试使用新版 docker compose 插件命令，如果失败则提示
    if ! docker compose version &> /dev/null; then
        echo "请手动安装 Docker Compose 插件"
    fi
fi

# 3. 生成 package.json
echo "正在生成 package.json..."
cat > package.json <<EOF
{
  "name": "bili-hanser-analysis",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "axios": "^1.6.0",
    "cookie-parser": "^1.4.6",
    "cors": "^2.8.5",
    "express": "^4.18.2",
    "qrcode": "^1.5.3"
  }
}
EOF

# 4. 生成 Dockerfile
echo "正在生成 Dockerfile..."
cat > Dockerfile <<EOF
FROM node:18-alpine
WORKDIR /app
RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo "Asia/Shanghai" > /etc/timezone
COPY package.json ./
RUN npm install --registry=https://registry.npmmirror.com
COPY . .
RUN mkdir -p user_data
EXPOSE 3000
CMD ["node", "server.js"]
EOF

# 5. 生成 docker-compose.yml
echo "正在生成 docker-compose.yml..."
cat > docker-compose.yml <<EOF
version: '3'
services:
  bili-app:
    build: .
    container_name: bili_hanser_app
    restart: always
    ports:
      - "3000:3000"
    volumes:
      - ./user_data:/app/user_data
      - ./server_config.json:/app/server_config.json
EOF

# 6. 初始化必要的挂载文件
# 注意：如果 server_config.json 不存在，Docker 会把它创建为目录，导致报错。
# 所以必须先在宿主机创建一个空文件。
echo "初始化配置文件..."
if [ ! -f "server_config.json" ]; then
    echo "{}" > server_config.json
fi

if [ ! -d "user_data" ]; then
    mkdir user_data
fi

# 7. 启动容器
echo -e "${GREEN}正在构建并启动容器...${NC}"
# 兼容 docker-compose (旧) 和 docker compose (新)
if docker compose version &> /dev/null; then
    docker compose up -d --build
else
    docker-compose up -d --build
fi

echo -e "${GREEN}=== 部署完成！ ===${NC}"
echo -e "访问地址: http://服务器IP:3000"
echo -e "管理员后台: http://服务器IP:3000/admin"
echo -e "查看日志: docker logs -f bili_hanser_app"
