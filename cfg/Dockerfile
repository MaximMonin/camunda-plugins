FROM camunda/camunda-bpm-platform:tomcat-7.14.0
RUN rm -r webapps/camunda-invoice webapps/examples webapps/h2
COPY postgresql-42.2.16.jar /camunda/lib/postgresql-9.4.1212.jar
COPY web.xml /camunda/webapps/engine-rest/WEB-INF/web.xml
COPY bpm-platform.xml /camunda/conf/

# Custom pluging for cockpit: adding history data in interface
COPY scripts/* /camunda/webapps/camunda/app/cockpit/scripts/

# Custom process engine plugins
COPY plugins/* /camunda/lib/