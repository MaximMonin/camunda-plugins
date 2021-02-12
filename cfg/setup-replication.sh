#!/bin/bash

echo "host replication camunda 0.0.0.0/0 md5" >> $PGDATA/pg_hba.conf
psql -c "select pg_reload_conf()"
