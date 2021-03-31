const { Variables } = require('camunda-external-task-client-js');
const { excelCreate } = require ('./excel.js');
const http = require ('http');
const https = require ('https');
const httpagent = new http.Agent({ keepAlive: true });
const httpsagent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });
const axios = require ('axios'); axios.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest';
const { v4: uuidv4 } = require('uuid');
const { createLogger, format, transports } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const FormData = require('form-data');
// Lock and unlock resource with redis redlock
const { Redlock } = require ('./redis.js');


const redisCacheHours = process.env.redisCacheHours || 1;
const maxLogDays = process.env.maxLogDays || 14;
const maxLogErrDays = process.env.maxLogErrDays || 60;

var transport = new DailyRotateFile({
    filename: 'internal-service-%DATE%.log',
    dirname: '/logs',
    datePattern: 'YYYY-MM-DD',
    maxFiles: maxLogDays + 'd'
});
var transportErr = new DailyRotateFile({
    level: 'error',
    filename: 'internal-service-error-%DATE%.log',
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
  defaultMeta: { service: 'InternalService' },
  transports: [
    new transports.Console(),
    transport,
    transportErr,
  ],
});

const telegramBot = 'yourTelegramBot';
const ServiceRules = [
   // Special methods for locking and unlocking resource
   // Queries to redis cluster
   { method: 'resource.Lock', rules: '', timeout: 600},
   { method: 'resource.Unlock', rules: ''},

   // Add rows to temp table
   { method: 'table.AddRows', rules: 'table,data'},
   // Read data from temp table
   { method: 'table.Read', rules: 'table',  resultReturn: 'data', useRedisCache: true},
   // Read data from cache and return native json data
   { method: 'cache.Read', rules: 'data,conversion',  resultReturn: 'data'},
   // Create excel file from
   { method: 'excel.Create', rules: 'sheets,data',  resultReturn: 'data', useRedisCache: true},

   // Special method to do nothing, just return back. Useful for engine test
   { method: 'null', rules: ''},

   // get enviroment variables for current server
   { method: 'environment.Get', rules: '', resultReturn: 'env'},

   // Send message to telegram
   { method: 'telegram', rules: 'chat_id,parse_mode', url: 'https://api.telegram.org/bot' + telegramBot + '/sendMessage'},
   // Send file to telegram
   { method: 'telegram.File', rules: 'chat_id,filename,data', url: 'https://api.telegram.org/bot' + telegramBot + '/sendDocument'},
];


class InternalServiceCore {
  constructor(task, taskService, method, redis) {
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
    this.redis = redis;
    this.sequenceId = this.processId;
    if (task.businessKey) {
      this.sequenceId = task.businessKey;
    }    
    this.defaultHandler = this.taskService.error;
    this.processVariables = new Variables();
    this.localVariables = new Variables();
    this.error = '';

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

    if (this.method == 'null') {
      logger.log({level: 'info', message: {type: 'NULL', sequenceId: sequenceId}});
      callback (service, {result: {}});
      return;
    }
    // Special method for locking and unlocking resource
    if (this.method == 'resource.Lock') {
      var lockResource = 'lock';
      if (this.params.key) {
        lockResource = lockResource + ':' + this.params.key;
      }
      logger.log({level: 'info', message: {type: 'LOCK', resource: lockResource, timeout: service.timeout, sequenceId: sequenceId}});
      this.redis.redlock.lock(lockResource, service.timeout * 1000, function(err, lock) {
        service.responsetime = Date.now() - begintime;
        if (err) {
          logger.log({level: 'info', message: {type: 'CANTLOCK', resource: lockResource, timeout: service.timeout, responsetime: service.responsetime, sequenceId: sequenceId}});
          callback (service, 'Repeat again later');
          return;
        }

        logger.log({level: 'info', message: {type: 'LOCKED', resource: lockResource, timeout: service.timeout, responsetime: service.responsetime, sequenceId: sequenceId}});
        var lockkey = {resource: lockResource, timeout: service.timeout, value: lock.value};
        callback (service, {lock: lockkey});
      });
      return;
    }
    if (this.method == 'resource.Unlock') {
      var lockkey = JSON.parse(this.task.variables.get('lock'));
      logger.log({level: 'info', message: {type: 'UNLOCK', resource: lockkey.resource, sequenceId: sequenceId}});
      try {
        var lock = new Redlock.Lock(this.redis.redlock, lockkey.resource, lockkey.value, lockkey.timeout * 1000);
        lock.unlock(function(err) {
          console.log (err);
        });
        callback (service, {result: {}});
      }
      catch (e) {
        callback (service, {result: {}});
      }
      return;
    }
    // Add data row to table, by using Redis rpush
    if (this.method == 'table.AddRows') {
      logger.log({level: 'info', message: {type: 'TABLE.ADD.ROWS', table: service.params.table, sequenceId: sequenceId}});
      try {
        for (var i=0; i < service.params.data.length; i++) {
          await service.redis.rpushAsync(service.params.table, JSON.stringify(service.params.data[i]));
        }
        await service.redis.expireAsync(service.params.table, redisCacheHours * 3600);
        service.responsetime = Date.now() - begintime;
        logger.log({level: 'info', message: {type: 'TABLE.ROWS.ADDED', table: service.params.table, responsetime: service.responsetime, sequenceId: sequenceId}});
        callback (service, {result: {}});
      }
      catch (err) {
        console.log(err);
        service.responsetime = Date.now() - begintime;
        logger.log({level: 'error', message: {type: 'TABLE.CANT.ADD', table: service.params.table, responsetime: service.responsetime, sequenceId: sequenceId}});
        callback (service, {error: err});
      }
      return;
    }
    // Read all table rows, by using Redis lrange
    if (this.method == 'table.Read') {
      logger.log({level: 'info', message: {type: 'TABLE.READ', table: service.params.table, sequenceId: sequenceId}});
      try {
        service.redis.lrange(service.params.table, function(err, items) {
          if (err) {
            console.log(err);
            service.responsetime = Date.now() - begintime;
            logger.log({level: 'error', message: {type: 'TABLE.CANT.READ', table: service.params.table, responsetime: service.responsetime, sequenceId: sequenceId}});
            callback (service, {error: err});
            return;
          }
          var data = [];
          items.forEach((item) => {
            data.push(JSON.parse(item));
          });
          service.responsetime = Date.now() - begintime;
          logger.log({level: 'info', message: {type: 'TABLE.READ.OK', table: service.params.table, responsetime: service.responsetime, sequenceId: sequenceId}});
          callback (service, {result: {data: JSON.stringify(data)}});
        });
      }
      catch (err) {
        console.log(err);
        service.responsetime = Date.now() - begintime;
        logger.log({level: 'error', message: {type: 'TABLE.CANT.READ', table: service.params.table, responsetime: service.responsetime, sequenceId: sequenceId}});
        callback (service, {error: err});
      }
      return;
    }
    // Read data from redis cache and return data object
    if (this.method == 'cache.Read') {
      logger.log({level: 'info', message: {type: 'CACHE.READ', conversion: service.params.conversion, sequenceId: sequenceId}});
      try {
        data = service.params.data;
        if (data.startsWith('redis:')) {
          key = data.substring(6);
          data = await service.redis.getAsync (key);
        }
        if (service.params.conversion.includes ('base64')) {
          data = Buffer.from(data, 'base64').toString();
        }
        if (service.params.conversion.includes ('json')) {
          data = JSON.parse(data);
        }
        service.responsetime = Date.now() - begintime;
        logger.log({level: 'info', message: {type: 'CACHE.READ.OK', conversion: service.params.conversion, responsetime: service.responsetime, sequenceId: sequenceId}});
        callback (service, {result: {data: data}});
      }
      catch (err) {
        console.log(err);
        service.responsetime = Date.now() - begintime;
        logger.log({level: 'error', message: {type: 'CACHE.CANT.READ', conversion: service.params.conversion, responsetime: service.responsetime, sequenceId: sequenceId}});
        callback (service, {error: err});
      }
      return;
    }
    // write array of data tables to excel file
    if (this.method == 'excel.Create') {
      logger.log({level: 'info', message: {type: 'EXCEL.CREATE', sheets: service.params.sheets, sequenceId: sequenceId}});
      try {
        data = await excelCreate(service, service.params.sheets, service.params.data);
        service.responsetime = Date.now() - begintime;
        logger.log({level: 'info', message: {type: 'EXCEL.CREATED', sheets: service.params.sheets, responsetime: service.responsetime, sequenceId: sequenceId}});
        callback (service, {result: {data: data}});
      }
      catch (err) {
        console.log(err);
        service.responsetime = Date.now() - begintime;
        logger.log({level: 'error', message: {type: 'EXCEL.CANT.CREATE', sheets: service.params.sheets, responsetime: service.responsetime, sequenceId: sequenceId}});
        callback (service, {error: err});
      }
      return;
    }

    if (this.method == 'environment.Get') {
      logger.log({level: 'info', message: {type: 'ENVIRONMENT', sequenceId: sequenceId}});
      try {
        callback (service, {result: {env: {server: process.env.SERVER, env: process.env.ENVIRONMENT}}});
      }
      catch (e) {
        callback (service, {result: {env:{server: 'SERVERNotDefined', env: 'ENVIRONMENTNotDefined'}}});
      }
      return;
    }

    var id = uuidv4();
    data = service.params;
    var url = service.url;
    if (this.method == 'telegram') {
      var text = encodeURI(this.task.variables.get('message'));
      url = url + '?text=' + text;
      url = url.replace(/#/g, '%23');
    }

    // Extend Camunda Lock for current task to timeout value if needed
    if (Date.now() + service.timeout * 1000 - new Date(service.task.lockExpirationTime) > 0 ) {
      if (! await lockTask (service, service.timeout * 1000)) {
        callback (service, 'Repeat again later');
        return;
      }
    }

    try { var params = JSON.parse(JSON.stringify(service.params)); } catch {}
    logger.log({level: 'info', message: {type: 'REQUEST', id: id, process: service.task.processDefinitionKey, method: service.method, params: params, sequenceId: sequenceId}});

    // Check for redis caching (filedata or passwords)
    try {
      if (data && data.data && data.data.includes ('redis:')) {
        key = data.data.substring(6);
        data.data = await service.redis.getAsync (key);
      }
      if (data && data.password && data.password.includes ('redis:')) {
        key = data.password.substring(6);
        data.password = await service.redis.getAsync (key);
      }
    }
    catch (e) {
      console.log (e);
    }

    var headers = {'Content-Type': 'application/json', 'Accept': 'application/json'};
    if (this.method == 'telegram.File') {
      const formData = new FormData();
      formData.append('document', Buffer.from(data.data, 'base64'), data.filename);
      headers = formData.getHeaders();
      url = url + '?chat_id=' + data.chat_id;
      data = formData;
    }

    axios({
      method: 'post',
      url: url,
      data: data,
      httpAgent: httpagent,
      httpsAgent: httpsagent,
      timeout: service.timeout * 1000,
      headers: headers
    })
    .then(response => {
      service.responsetime = Date.now() - begintime;
      var result = response.data;
      try {
        var logresult = JSON.parse(JSON.stringify(result));
        if (logresult.result && logresult.result.data) {
          logresult.result.data = 'result data...(omited)';
        }
      } catch {}
      logger.log({level: 'info', message: {type: 'RESPONSE', id: id, process: service.task.processDefinitionKey, method: service.method, result: logresult, responsetime: service.responsetime, sequenceId: sequenceId}});

      callback (service, result);
    })
    .catch(function (error) {
      service.responsetime = Date.now() - begintime;
      var errdata;
      if (error.response) {
        errdata = error.response.data;
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

module.exports = {InternalServiceCore};
