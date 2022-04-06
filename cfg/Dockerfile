FROM camunda/camunda-bpm-platform:tomcat-7.17.0
RUN rm -r webapps/camunda-invoice webapps/examples webapps/h2
#COPY postgresql-42.3.3.jar /camunda/lib/postgresql-42.3.3.jar
COPY web.xml /camunda/webapps/engine-rest/WEB-INF/web.xml
COPY bpm-platform.xml /camunda/conf/

# Custom pluging for cockpit: adding history data in interface
COPY scripts/* /camunda/webapps/camunda/app/cockpit/scripts/

# Custom process engine plugins
COPY plugins/* /camunda/lib/

# session management
RUN wget https://repo1.maven.org/maven2/org/redisson/redisson-tomcat-9/3.17.0/redisson-tomcat-9-3.17.0.jar -P lib/ && \
    wget https://repo1.maven.org/maven2/org/redisson/redisson-all/3.17.0/redisson-all-3.17.0.jar -P lib/
COPY redisson.conf /camunda/conf/
COPY context.xml  /camunda/webapps/camunda/META-INF/
COPY context.xml  /camunda/webapps/camunda-welcome/META-INF/
