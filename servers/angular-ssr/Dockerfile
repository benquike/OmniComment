FROM node:20-alpine

WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install

COPY server.ts ./
COPY src/ ./src/

ENV PORT=4000 \
    NODE_ENV=production \
    OMNICOMMENT_DATA_PATH=/data/comments.json

RUN mkdir -p /data

EXPOSE 4000

CMD ["npx", "ts-node", "server.ts"]
