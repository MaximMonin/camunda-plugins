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

## InternalService [(Documentation)](doc/InternalService.md) 
It is Nodejs example service that consists some kernel systemwide utils.

Some params in .env file:
**(Camunda Client log level)**   
LogLevel=info   
**(Long polling for workers once in N ms, default 60 sec)**   
LongPolling=60000   
**(Default lock duration for external task, default 50 sec)**   
lockDuration=50000   
**(rotate logfile days)**   
maxLogDays=14   
**(rotate error logfile days)**   
maxLogErrDays=60   
**(keep redis cache in Hours)**   
redisCacheHours=24   

**(Telegram bot who sends messages)**   
TELEGRAM_BOT   
**(Mail server and mail credetials for user who sends email from Camunda)**   
MAIL_SERVER   
MAIL_PORT   
MAIL_ACCOUNT   
MAIL_PASSWORD   
MAIL_FROM   
**(Secret CryptoKey to encrypt/decrypt secret info)**   
CRYPTO_KEY   
