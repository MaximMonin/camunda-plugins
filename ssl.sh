#!/bin/bash

mkdir cfg/ssl
openssl genrsa -out cfg/ssl/rootcamundaCA.key 2048
openssl req -x509 -new -nodes -key cfg/ssl/rootcamundaCA.key -sha256 -days 3650 -out cfg/ssl/rootcamundaCA.crt \
 -subj "/C=UA/ST=Dev/L=Dev/O=YourEnt/OU=IT/CN=camundaCA"

openssl req -new -newkey rsa:2048 -nodes -out cfg/ssl/camunda.csr -keyout cfg/ssl/camunda.key \
 -subj "/C=UA/ST=Dev/L=Dev/O=YourEnt/OU=IT/CN=camunda"
openssl x509 -req -days 3650 -in cfg/ssl/camunda.csr -CA cfg/ssl/rootcamundaCA.crt -CAkey cfg/ssl/rootcamundaCA.key -CAcreateserial -out cfg/ssl/camunda.crt -extfile cfg/v3.cnf

openssl pkcs12 -export -in cfg/ssl/camunda.crt -inkey cfg/ssl/camunda.key -out cfg/ssl/camunda.p12 -name tomcat
openssl dhparam -out cfg/ssl/dhparam.pem 4096
chmod 644 cfg/ssl/camunda.p12

