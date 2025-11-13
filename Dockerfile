# base Image
FROM node:18-slim
WORKDIR /app

# install ONLY production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --production

# copy source code
COPY src ./src
COPY tsconfig.json ./

RUN npm run build

# expose port
EXPOSE 3001

ENV NODE_ENV=production

# start the server
CMD [ "npm", "run", "start" ]