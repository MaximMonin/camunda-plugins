FROM camunda/camunda-bpm-platform:tomcat-7.23.0
RUN rm -r webapps/camunda-invoice webapps/examples && \
    rm -f lib/postgresql-42.5.5.jar && \
    wget https://jdbc.postgresql.org/download/postgresql-42.7.5.jar -P lib/
COPY web.xml webapps/engine-rest/WEB-INF/web.xml
COPY bpm-platform.xml conf/

# Custom pluging for cockpit: adding history data in interface + process statistics
COPY scripts/* webapps/camunda/app/cockpit/scripts/
# Custom pluging for tasklist: adding history data in interface
COPY scripts2/* webapps/camunda/app/tasklist/scripts/

# Custom process engine plugins
RUN wget https://repo1.maven.org/maven2/redis/clients/jedis/3.10.0/jedis-3.10.0.jar -P lib/ && \
    wget https://repo1.maven.org/maven2/org/jsoup/jsoup/1.19.1/jsoup-1.19.1.jar -P lib/
COPY plugins/* lib/

# session management
RUN wget https://repo1.maven.org/maven2/org/redisson/redisson-tomcat-10/3.45.1/redisson-tomcat-10-3.45.1.jar -P lib/ && \
    wget https://repo1.maven.org/maven2/org/redisson/redisson-all/3.45.1/redisson-all-3.45.1.jar -P lib/
COPY redisson.conf conf/
COPY context.xml  webapps/camunda/META-INF/
COPY context.xml  webapps/camunda-welcome/META-INF/
