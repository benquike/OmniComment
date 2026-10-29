FROM php:8.2-cli-alpine

WORKDIR /app

RUN apk add --no-cache sqlite-dev sqlite \
    && docker-php-ext-install pdo pdo_sqlite

COPY . .

RUN mkdir -p data

EXPOSE 8000

CMD ["php", "-S", "0.0.0.0:8000", "-t", "public"]
