FROM node:20-alpine3.16

WORKDIR /app

COPY package.json yarn.lock tsconfig.json ./

RUN yarn

RUN npx prisma generate

RUN npx prisma migrate dev

COPY . .

CMD ["yarn", "dev"]