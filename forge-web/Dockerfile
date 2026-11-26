FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.6.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build
FROM nginx:stable-alpine
ENV API_UPSTREAM=http://api:3009
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80
