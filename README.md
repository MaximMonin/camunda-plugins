# camunda-plugins

Useful Camunda plugins for Camunda 7.14+ in docker Enviroment   

Included:   
Camunda Cockpit History Plugins:   
https://github.com/datakurre/camunda-cockpit-plugins/   

Java .jar plugins in docker images:
1. Incident plugin - Call Service.IncidentHandler model to notify About all Camunda Incidents to telegram   
2. Auto create Admin User - check https://github.com/DigitalState/camunda-administrative-user-plugin   
3. ProcessEnd plugin - call publish message to redis servers or https call to some api to indicate that process ends with id and state   


build.sh - generate Docker images   
ssl.sh - generate ssl certificates   
start.sh / stop.sh - Start and stop Service   
Check .env file to configure passwords and ports

create user camunda/camunda for workers through camunda admin
service/deploy.sh - deploy models
