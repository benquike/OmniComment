FROM ruby:3.3-slim

WORKDIR /app

RUN apt-get update -qq && apt-get install -y --no-install-recommends build-essential && rm -rf /var/lib/apt/lists/*

COPY Gemfile Gemfile.lock* ./
RUN bundle install || true

COPY . .

ENV PORT=8000 \
    OMNICOMMENT_DATA_PATH=/data/comments.json

RUN mkdir -p /data

EXPOSE 8000

# Runs standalone WEBrick server by default (or bundle exec puma -C config.ru)
CMD ["ruby", "server.rb"]
