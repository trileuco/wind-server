FROM node:14-buster

RUN apt-get update && \
    apt-get install -y --no-install-recommends default-jre && \
    rm -rf /var/lib/apt/lists/*

ENV JAVA_HOME /usr

WORKDIR /app
RUN set -x && groupadd -r -g 888 app && \
    useradd -r -u 888 -g app -d /app app && \
    chown -R app:app /app
USER app

# Download dependencies independent of application for faster build
COPY package.json /app/
RUN npm install

# Copy application
COPY . .

CMD ["npm", "start"]
