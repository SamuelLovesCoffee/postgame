FROM node:22-slim

RUN apt-get update && \
    apt-get install -y stockfish && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY . .

ENV STOCKFISH_PATH=/usr/games/stockfish
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server/index.js"]
