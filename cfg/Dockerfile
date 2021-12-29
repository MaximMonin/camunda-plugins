FROM camunda/camunda-bpm-platform:tomcat-7.16.0
RUN rm -r webapps/camunda-invoice webapps/examples webapps/h2
COPY postgresql-42.2.24.jar /camunda/lib/postgresql-42.1.0.jar
COPY web.xml /camunda/webapps/engine-rest/WEB-INF/web.xml
COPY bpm-platform.xml /camunda/conf/

# Custom pluging for cockpit: adding history data in interface
COPY scripts/* /camunda/webapps/camunda/app/cockpit/scripts/

# Custom process engine plugins
COPY plugins/* /camunda/lib/

# session management
RUN wget https://repo1.maven.org/maven2/org/redisson/redisson-tomcat-9/3.16.7/redisson-tomcat-9-3.16.7.jar -P lib/ && \
    wget https://repo1.maven.org/maven2/org/redisson/redisson-all/3.16.7/redisson-all-3.16.7.jar -P lib/
COPY redisson.conf /camunda/conf/
COPY context.xml  /camunda/webapps/camunda/META-INF/
COPY context.xml  /camunda/webapps/camunda-welcome/META-INF/
