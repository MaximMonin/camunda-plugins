FROM camunda/camunda-bpm-platform:tomcat-7.18.0
RUN rm -r webapps/camunda-invoice webapps/examples && \
    rm -f lib/postgresql-42.3.3.jar && \
    wget https://jdbc.postgresql.org/download/postgresql-42.5.0.jar -P lib/
COPY web.xml webapps/engine-rest/WEB-INF/web.xml
COPY bpm-platform.xml conf/

# Custom pluging for cockpit: adding history data in interface + process statistics
COPY scripts/* webapps/camunda/app/cockpit/scripts/
# Custom pluging for tasklist: adding history data in interface
COPY scripts2/* webapps/camunda/app/tasklist/scripts/

# Custom process engine plugins
COPY plugins/* lib/

# session management
RUN wget https://repo1.maven.org/maven2/org/redisson/redisson-tomcat-9/3.17.7/redisson-tomcat-9-3.17.7.jar -P lib/ && \
    wget https://repo1.maven.org/maven2/org/redisson/redisson-all/3.17.7/redisson-all-3.17.7.jar -P lib/
COPY redisson.conf conf/
COPY context.xml  webapps/camunda/META-INF/
COPY context.xml  webapps/camunda-welcome/META-INF/
