FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN DATABASE_URL="postgresql://aman:secret@localhost:5433/mydb" npx prisma generate

EXPOSE 3000

CMD ["npx", "tsx", "src/index.ts"]