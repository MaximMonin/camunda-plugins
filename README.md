# camunda-plugins

Useful Camunda plugins for Camunda 7.14+ in docker Environment   

Included:   
Camunda Cockpit History Plugins:   
https://github.com/datakurre/camunda-cockpit-plugins/   

Java .jar plugins in docker image:
1. Incident plugin - Calls Service.IncidentHandler model to notify About all Camunda Incidents to telegram   
2. Auto create Admin User + Worker user on first start - check https://github.com/DigitalState/camunda-administrative-user-plugin   
3. ProcessEnd plugin - call publish message to redis servers or https call to some api to indicate that process ends with id and state   

Copy .env-dev to .env   
build.sh - generate Docker images   
ssl.sh - generate ssl certificates   
start.sh / stop.sh - Start and stop Service   
Check .env file to configure passwords and ports   
service/deploy.sh - deploy models   
test/service/*.sh - Run tests, speed tests, stress tests   
