# ---- Build Stage ----
FROM node:18-slim AS builder
WORKDIR /app

# copy package files
COPY package.json package-lock.json* ./
# install deps
RUN npm ci

# copy source code
COPY src ./src
COPY tsconfig.json ./

# run the build script
RUN npm run build
# creating the 'dist' folder


# ---- Production Stage ----
# Start fresh with a clean slim image
FROM node:18-slim
WORKDIR /app

# copy package files again
COPY package.json package-lock.json* ./

# install ONLY production dependencies
RUN npm ci --production

# copy the compiled code from the 'builder' stage
COPY --from=builder /app/dist ./dist

# expose port and start
EXPOSE 3001
ENV NODE_ENV=production
CMD [ "npm", "run", "start" ]