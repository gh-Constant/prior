FROM node:20-alpine AS build

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY app/package.json app/package.json
RUN pnpm install --frozen-lockfile

COPY app app
ARG VITE_API_URL=https://api.prior.constantsuchet.fr
ENV VITE_API_URL=${VITE_API_URL}
RUN pnpm --dir app build

FROM nginx:1.27-alpine
COPY app/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/health || exit 1
