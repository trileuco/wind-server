FROM node:14-buster

RUN apt-get update && \
    apt-get install -y --no-install-recommends default-jre && \
    rm -rf /var/lib/apt/lists/*

ENV JAVA_HOME /usr

WORKDIR /opt/app

# Download dependencies independent of application for faster build
COPY package.json /opt/app/
RUN npm install

COPY . /opt/app/

CMD ["npm", "start"]
