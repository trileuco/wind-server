FROM  node:7.4

RUN apt-get update
RUN apt-get install -y default-jre
ENV JAVA_HOME /usr

WORKDIR /opt/app

COPY . /opt/app/
RUN npm install

CMD [ "npm", "start" ]

