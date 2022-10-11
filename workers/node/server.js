'use strict';

require('dotenv').config({path: '/app/.env'});
const { Client, logger, BasicAuthInterceptor } = require('camunda-external-task-client-js');
// const fs = require('fs');
const { Worker } = require ('./js/worker.js');
const { Redis } = require ('./js/redis.js');
const { Mailer } = require ('./js/mailer.js');

// configuration for the Camunda Client:
//  - 'baseUrl': url to the Process Engine
//  - 'logger': utility to automatically log important events
//  - 'asyncResponseTimeout': long polling timeout (then a new request will be issued)

//  - 'maxTasks': The maximum number of tasks to fetch from Camunda in batch
//  - 'maxParallelExecutions': The maximum number of tasks to be worked on simultaneously
//  Number of async execution threads = maxTasks if maxParallelExcecutions is not set
//  Else Number of async threads = min (MaxTasks,maxParallelExcecutions)

const url = process.env.CamundaUrl || 'http://camunda:8080/engine-rest';
const RedisUrls = process.env.RedisUrls || 'redis:6379';
const longPolling = process.env.LongPolling || 60000;
const lockDuration = process.env.lockDuration || 50000;
const tasktype = process.env.TaskType || 'service-task';
const loglevel = process.env.LogLevel || 'INFO';
const maxTasks = process.env.JobsToActivate || 25;
const workerId = process.env.workerId || 'some-random-id';
const caPass = Buffer.from(process.env.CAMUNDA_PASSWORD, 'base64').toString().substring(0,Buffer.from(process.env.CAMUNDA_PASSWORD, 'base64').toString().length - 1) || 'camunda';

console.log('Camunda Node worker is starting...');

const basicAuthentication = new BasicAuthInterceptor({
  username: 'camunda',
  password: caPass
});
/*
const caRoot = fs.readFileSync('/ssl/camundaCA.crt')
class SslInterceptor {
  constructor(options) {
    this.interceptor = this.interceptor.bind(this);
    this.https = options;
    return this.interceptor;
  }
  interceptor(config) {
    return { ...config, ...this.https };
  }
}
const sslValidation = new SslInterceptor({ca: caRoot});
*/

// for fast parallel processing it is critical to reduse polling internal to low value
// create a Client instance with custom configuration
const config = { baseUrl: url, workerId: workerId, use: logger.level(loglevel), asyncResponseTimeout: longPolling, lockDuration: lockDuration,
  maxTasks: maxTasks, interval: 10, autoPoll: false, interceptors: [basicAuthentication /*, sslValidation */] };
const client = new Client(config);
client.taskService.defaultErrorHandler = client.taskService.error;
const redis = new Redis (RedisUrls);
const mailer = new Mailer ();
const worker = new Worker (redis, mailer);

var options = {};
if (tasktype == 'InternalService') {
  options = {variables: ['method', 'params', 'timeout', 'url', 'lock', 'message']};
}

const topicSubscription = client.subscribe(tasktype, options, async function ({task, taskService}) {
//  console.log (JSON.stringify(task));

  worker.router (task, taskService);
});

void (async () => {
  if (tasktype == 'InternalService') {
    mailer.init ();
  }
  client.start();
})();


// For docker enviroment it catch docker compose down/restart commands
// The signals we want to handle
// NOTE: although it is tempting, the SIGKILL signal (9) cannot be intercepted and handled
var signals = {
  'SIGHUP': 1,
  'SIGINT': 2,
  'SIGTERM': 15
};
// Do any necessary shutdown logic for our application here
const shutdown = (signal, value) => {
  console.log('Camunda Node worker stopped');
  process.exit(128 + value);
};
// Create a listener for each of the signals that we want to handle
Object.keys(signals).forEach((signal) => {
  process.on(signal, () => {
    console.log('Camunda Node worker is shutdowning');

    topicSubscription.unsubscribe();
    client.stop();

    redis.stop ();
    mailer.stop ();
    shutdown(signal, signals[signal]);
  });
});
