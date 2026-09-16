# ---- Base ----
FROM node:24-alpine AS base
WORKDIR /app

# ---- Development (used by docker-compose.yml) ----
FROM base AS development
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
EXPOSE 3000
CMD ["npm", "run", "start:dev"]

# ---- Build ----
FROM base AS build
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

# ---- Production runtime ----
FROM base AS production
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main.js"]
