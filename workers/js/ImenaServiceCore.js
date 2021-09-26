'use strict';

const { Variables } = require('camunda-external-task-client-js');
const http = require ('http');
const https = require ('https');
const httpagent = new http.Agent({ keepAlive: true });
const httpsagent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });
const axios = require ('axios'); axios.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest';
const { v4: uuidv4 } = require('uuid');
const { createLogger, format, transports } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');

const apiKey = process.env.IMENA_API_KEY;
const rpcUrl = 'https://rpc.imena.ua/v1/';

const maxLogDays = process.env.maxLogDays || 14;
const maxLogErrDays = process.env.maxLogErrDays || 60;

const transport = new DailyRotateFile({
    filename: 'imena-service-%DATE%.log',
    dirname: '/logs',
    datePattern: 'YYYY-MM-DD',
    maxFiles: maxLogDays + 'd'
});
const transportErr = new DailyRotateFile({
    level: 'error',
    filename: 'imena-service-error-%DATE%.log',
    dirname: '/logs',
    datePattern: 'YYYY-MM-DD',
    maxFiles: maxLogErrDays + 'd'
});

// Filter passwords and large data
const ignorePrivate = format((info) => {
  var data = info.message;
  try {
    if (data.params.password) {
      data.params.password = '(filtered)';
    }
    if (data.params.apiKey) {
      data.params.apiKey = '(filtered)';
    }
    if (data.params.data) {
      data.params.data = 'data...(omited)';
    }
  }
  catch {
  }
  return info;
});

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    ignorePrivate(),
    format.json()
  ),
  defaultMeta: { service: 'ImenaService' },
  transports: [
    new transports.Console(),
    transport,
    transportErr,
  ],
});

const ServiceRules = [
   // Queries to Imena Service
   { method: 'getDomainsCanBePremiumList', rules: '', resultReturn: 'json', timeout: 30},
   { method: 'actualizeDomainPremiumData', rules: 'serviceCode', timeout: 60}
];

class ImenaServiceCore {
  constructor(task, taskService, method, worker) {
    this.task = task;
    this.taskService = taskService;
    this.method = method;
    this.params = {};
    this.timeout = 20;
    this.processId = task.processInstanceId;
    this.taskId = task.id;
    this.maxErrors = 3;
    this.ignoreErrors = [];
    this.resultReturn = null;
    this.useRedisCache = false;
    this.responsetime = 0;
    this.redis = worker.redis;
    this.sequenceId = this.processId;
    if (task.businessKey) {
      this.sequenceId = task.businessKey;
    }
    this.defaultHandler = this.taskService.error;
    this.processVariables = new Variables();
    this.localVariables = new Variables();
    this.error = '';
    this.url = rpcUrl;
    this.apiKey = apiKey;

    try {
      var params = task.variables.get('params');
      if (params) {
        if (typeof params == 'string') {
          params = JSON.parse (params);
        }
        this.params = params;
      }
    }
    catch {
    }

    for(var i=0; i < ServiceRules.length; i++) {
      if (ServiceRules[i].method == method && ServiceRules[i].ignoreErrors) {
        this.ignoreErrors = ServiceRules[i].ignoreErrors;
      }
    }
    for(i=0; i < ServiceRules.length; i++) {
      if (ServiceRules[i].method == method && ServiceRules[i].resultReturn) {
        this.resultReturn = ServiceRules[i].resultReturn;
      }
    }
    for(i=0; i < ServiceRules.length; i++) {
      if (ServiceRules[i].method == method && ServiceRules[i].useRedisCache) {
        this.useRedisCache = ServiceRules[i].useRedisCache;
      }
    }
    for(i=0; i < ServiceRules.length; i++) {
      if (ServiceRules[i].method == method && ServiceRules[i].timeout) {
        this.timeout = ServiceRules[i].timeout;
      }
    }
    for(i=0; i < ServiceRules.length; i++) {
      if (ServiceRules[i].method == method && ServiceRules[i].url) {
        this.url = ServiceRules[i].url;
      }
    }
    for(i=0; i < ServiceRules.length; i++) {
      if (ServiceRules[i].method == method && ServiceRules[i].apiKey) {
        this.apiKey = ServiceRules[i].apiKey;
      }
    }

    try {
      var tasktimeout = task.variables.get('timeout');
      if (tasktimeout) {
        this.timeout = tasktimeout;
      }
      if (this.params ['timeout']) {
        this.timeout = this.params['timeout'];
      }
    }
    catch {
    }
    try {
      var taskurl = task.variables.get('url');
      if (taskurl) {
        this.url = taskurl;
      }
      if (this.params ['url']) {
        this.url = this.params['url'];
      }
    }
    catch {
    }
    if (this.apiKey) {
      this.params['apiKey'] = this.apiKey;
    }
  }
  /* Check method available */
  checkmethod ()
  {
    for(var i=0; i < ServiceRules.length; i++) {
      if (ServiceRules[i].method == this.method) {
        return true;
      }
    }
    return false;
  }

  /* Check required params list */
  checkparams ()
  {
    var rules;
    var rule;
    var i;
    for(i=0; i < ServiceRules.length; i++) {
      if (ServiceRules[i].method == this.method) {
       rules = ServiceRules[i].rules.split(',');
      }
    }

    for(i=0; i < rules.length; i++) {
      rule = rules[i];
      if (rule == '') {
        continue;
      }
      if (rule.includes('.')) {
        var parts = rule.split('.');
        if (this.params[parts[0]][parts[1]]) {
          continue;
        }
        return 'No params: ' + rule;
      }
      else {
        if (this.params[rule]) {
          continue;
        }
        return 'No params: ' + rule;
      }
    }
    return '';
  }
  async executeRequest (callback)
  {
    var begintime = Date.now();
    var sequenceId = this.sequenceId;
    var service = this;
    var key;
    var data;

    // Extend Camunda Lock for current task to timeout value if needed
    if (Date.now() + service.timeout * 1000 - new Date(service.task.lockExpirationTime) > 0 ) {
      if (! await lockTask (service, service.timeout * 1000)) {
        callback (service, 'Repeat again later');
        return;
      }
    }

    var id = uuidv4();
    var url = service.url;
    var headers = {'Content-Type': 'application/json', 'Accept': 'application/json'};
    data = {jsonrpc: '2.0', id: id, method: service.method, params: service.params};

    try { var params = JSON.parse(JSON.stringify(service.params)); } catch {}
    logger.log({level: 'info', message: {type: 'REQUEST', id: id, process: service.task.processDefinitionKey, method: service.method, params: params, sequenceId: sequenceId}});

    // Check for redis caching (filedata or passwords)
    try {
      if (data.params && data.params.data && data.params.data.includes ('redis:')) {
        key = data.params.data.substring(6);
        data.params.data = await service.redis.getAsync (key);
      }
      if (data.params && data.params.password && data.params.password.includes ('redis:')) {
        key = data.params.password.substring(6);
        data.params.password = await service.redis.getAsync (key);
      }
    }
    catch (e) {
      console.log (e);
    }

    var rpcdata = JSON.stringify(data);

    axios({
      method: 'post',
      url: url,
      data: rpcdata,
      httpAgent: httpagent,
      httpsAgent: httpsagent,
      timeout: service.timeout * 1000,
      headers: headers
    })
    .then(response => {
      service.responsetime = Date.now() - begintime;
      var result = response.data;
      logger.log({level: 'info', message: {type: 'RESPONSE', id: id, process: service.task.processDefinitionKey, method: service.method, responsetime: service.responsetime, sequenceId: sequenceId}});

      callback (service, result);
    })
    .catch(function (error) {
      service.responsetime = Date.now() - begintime;
      var errdata;
      if (error.response) {
        errdata = error.response.data;
        if (errdata == '' && error.response.statusText) {
          errdata = error.response.status + ' ' + error.response.statusText;
        }
      }
      else if (error.request) {
        errdata = 'Service request timeout: ' + url;
      }
      else {
        errdata = error.message;
      }
      logger.log({level: 'error', message: {type: 'RESPONSE', id: id, process: service.task.processDefinitionKey, method: service.method, error: errdata, responsetime: service.responsetime, sequenceId: sequenceId}});

      callback (service, {error: errdata});
    });

  }
}

// Trying to lock task and add execution time
async function lockTask (service, timeout)
{
  const sanitizedTask = service.taskService.sanitizeTask(service.task);
  try {
    await service.taskService.api.extendLock(sanitizedTask, timeout);
    return true;
  }
  catch (e) {
    // Another process locked or executed this task
    return false;
  }
}

module.exports = {ImenaServiceCore};
