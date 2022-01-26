'use strict';

const { Variables } = require('camunda-external-task-client-js');
const { excelCreate } = require ('./excel.js');
const { encrypt, decrypt } = require ('./crypto.js');
const http = require ('http');
const https = require ('https');
const httpagent = new http.Agent({ keepAlive: true });
const httpsagent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });
const axios = require ('axios'); axios.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest';
const { v4: uuidv4 } = require('uuid');
const { createLogger, format, transports } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const FormData = require('form-data');
const caPass = Buffer.from(process.env.CAMUNDA_PASSWORD, 'base64').toString().substring(0,Buffer.from(process.env.CAMUNDA_PASSWORD, 'base64').toString().length - 1) || 'camunda';
// Lock and unlock resource with redis redlock
const { Redlock } = require ('./redis.js');

const redisCacheHours = process.env.redisCacheHours || 1;
const maxLogDays = process.env.maxLogDays || 14;
const maxLogErrDays = process.env.maxLogErrDays || 60;
const telegramBot = process.env.TELEGRAM_BOT;

const transport = new DailyRotateFile({
    filename: 'internal-service-%DATE%.log',
    dirname: '/logs',
    datePattern: 'YYYY-MM-DD',
    maxFiles: maxLogDays + 'd'
});
const transportErr = new DailyRotateFile({
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

const ServiceRules = [
   // Special methods for locking and unlocking resource
   // Queries to redis cluster
   { method: 'resource.Lock', rules: '', timeout: 600},
   { method: 'resource.Unlock', rules: ''},

   // Add rows to temp table
   { method: 'table.AddRows', rules: 'table,data'},
   // Check number of records in temp table
   { method: 'table.Count', rules: 'table', resultReturn: 'data'},
   // Read data from temp table
   { method: 'table.Read', rules: 'table', resultReturn: 'data', useRedisCache: true},
   // Read data from redis cache and return native json data
   { method: 'cache.Read', rules: 'data,conversion', resultReturn: 'data'},
   // Create excel file from
   { method: 'excel.Create', rules: 'sheets,data', resultReturn: 'data', useRedisCache: true},

   // Special method to do nothing, just return back. Useful for engine test
   { method: 'null', rules: ''},

   // get enviroment variables for current server
   { method: 'environment.Get', rules: '', resultReturn: 'env'},
   // stop all other processes of this type of process except current process
   { method: 'processes.StopOther', rules: '' },

   // Send message to telegram
   { method: 'telegram', rules: 'chat_id,parse_mode', url: 'https://api.telegram.org/bot' + telegramBot + '/sendMessage'},
   // Send file to telegram
   { method: 'telegram.File', rules: 'chat_id,filename,data', url: 'https://api.telegram.org/bot' + telegramBot + '/sendDocument'},
   // Send email, check https://nodemailer.com/message/ for message format and other fields description
   // attachment file contents can be reference to redis cache file object
   { method: 'email', rules: 'to,subject'},

   // generatePassword
   { method: 'generatePassword', rules: 'length', resultReturn: 'data', useRedisCache: true},
   // encrypt/decrypt sensetive data like passwords
   { method: 'encrypt', rules: 'text,key', resultReturn: 'data', useRedisCache: true},
   { method: 'decrypt', rules: 'text,key', resultReturn: 'data', useRedisCache: true},
];


class InternalServiceCore {
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
    this.mailer = worker.mailer;
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
        if (this.params[parts[0]][parts[1]] || this.params[parts[0]][parts[1]] === false) {
          continue;
        }
        return 'No params: ' + rule;
      }
      else {
        if (this.params[rule] || this.params[rule] === false) {
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
      try {
        var lockkey = JSON.parse(this.task.variables.get('lock'));
        logger.log({level: 'info', message: {type: 'UNLOCK', resource: lockkey.resource, sequenceId: sequenceId}});
        var lock = new Redlock.Lock(this.redis.redlock, lockkey.resource, lockkey.value, lockkey.timeout * 1000);
        lock.unlock(function(err) {
          if (err) {
            console.log (err);
          }
          callback (service, {result: {}});
        });
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

    // Count record number in table, by using Redis llen
    if (this.method == 'table.Count') {
      logger.log({level: 'info', message: {type: 'TABLE.COUNT', table: service.params.table, sequenceId: sequenceId}});
      try {
        service.redis.llen(service.params.table, function(err, data) {
          if (err) {
            console.log(err);
            service.responsetime = Date.now() - begintime;
            logger.log({level: 'error', message: {type: 'TABLE.CANT.READ', table: service.params.table, responsetime: service.responsetime, sequenceId: sequenceId}});
            callback (service, {error: err});
            return;
          }
          service.responsetime = Date.now() - begintime;
          logger.log({level: 'info', message: {type: 'TABLE.COUNT.OK', table: service.params.table, responsetime: service.responsetime, sequenceId: sequenceId}});
          callback (service, {result: {data: data}});
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
    if (this.method == 'generatePassword') {
      logger.log({level: 'info', message: {type: 'GeneratePassword', params: service.params, sequenceId: sequenceId}});
      try {
        callback (service, {result: {data: genPassword (service.params.length)}});
      }
      catch (e) {
        callback (service, {error: e});
      }
      return;
    }
    if (this.method == 'encrypt') {
      logger.log({level: 'info', message: {type: 'encrypt', sequenceId: sequenceId}});
      try {
        data = service.params.text;
        if (data.startsWith('redis:')) {
          key = data.substring(6);
          data = await service.redis.getAsync (key);
        }
        data = encrypt (data, service.params.key);
        logger.log({level: 'info', message: {type: 'encrypt-done', sequenceId: sequenceId}});
        callback (service, {result: {data: data}});
      }
      catch (e) {
        console.log (e);
        logger.log({level: 'info', message: {type: 'encrypt-error', sequenceId: sequenceId}});
        callback (service, {error: e});
      }
      return;
    }
    if (this.method == 'decrypt') {
      logger.log({level: 'info', message: {type: 'decrypt', sequenceId: sequenceId}});
      try {
        data = service.params.text;
        if (data.startsWith('redis:')) {
          key = data.substring(6);
          data = await service.redis.getAsync (key);
        }
        data = decrypt (data, service.params.key);
        logger.log({level: 'info', message: {type: 'decrypt-done', sequenceId: sequenceId}});
        callback (service, {result: {data: data}});
      }
      catch (e) {
        console.log (e);
        logger.log({level: 'info', message: {type: 'decrypt-error', sequenceId: sequenceId}});
        callback (service, {error: e});
      }
      return;
    }

    // stop other processes of this type except current process
    if (this.method == 'processes.StopOther') {
      logger.log({level: 'info', message: {type: 'PROCESSES.STOPOTHER', process: service.task.processDefinitionKey, sequenceId: sequenceId}});
      try {
        await StopOther(service, service.task.processDefinitionKey, service.processId);
        service.responsetime = Date.now() - begintime;
        logger.log({level: 'info', message: {type: 'PROCESSES.STOPEDOTHER', process: service.task.processDefinitionKey, responsetime: service.responsetime, sequenceId: sequenceId}});
        callback (service, {result: {}});
      }
      catch (error) {
//        console.log(error.response);
        var errdata;
        if (error.response) {
          errdata = error.response.data;
        }
        else if (error.request) {
          errdata = 'Service request timeout: ' + service.taskService.api.baseUrl;
        }
        else {
          errdata = error.message;
        }
        service.responsetime = Date.now() - begintime;
        logger.log({level: 'error', message: {type: 'PROCESSES.CANT.STOP', process: service.task.processDefinitionKey, responsetime: service.responsetime, sequenceId: sequenceId}});
        callback (service, {error: errdata});
      }
      return;
    }
    if (this.method == 'email') {
      logger.log({level: 'info', message: {type: 'EMAIL.SEND', to: service.params.to, subject: service.params.subject, sequenceId: sequenceId}});
      try {
        // Replace file attachment as links to redis cache files
        if (service.params.attachments) {
          for (var j=0; j < service.params.attachments.length; j++) {
            var attachment = service.params.attachments[j];
            if (attachment.content && attachment.content.startsWith('redis:')) {
              attachment.content = await service.redis.getAsync (attachment.content.substring(6));
              attachment['encoding'] = 'base64';
            }
          }
        }
        service.mailer.sendMail(service.params, (error, info) => {
          service.responsetime = Date.now() - begintime;
          if (error) {
//            console.log (error);
            logger.log({level: 'error', message: {type: 'EMAIL.CANT.SEND', to: service.params.to, subject: service.params.subject, error: error.message, responsetime: service.responsetime, sequenceId: sequenceId}});
            callback (service, {error: error.message});
            return;
          }
          logger.log({level: 'info', message: {type: 'EMAIL.SENT', to: service.params.to, subject: service.params.subject, responsetime: service.responsetime, sequenceId: sequenceId}});
          callback (service, {result: {}});
        });
      }
      catch (errdata) {
        console.log(errdata);
        service.responsetime = Date.now() - begintime;
        logger.log({level: 'error', message: {type: 'EMAIL.CANT.SEND', to: service.params.to, subject: service.params.subject, responsetime: service.responsetime, sequenceId: sequenceId}});
        callback (service, {error: errdata});
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
      if (data && data.data && data.data.startsWith('redis:')) {
        key = data.data.substring(6);
        data.data = await service.redis.getAsync (key);
      }
      if (data && data.password && data.password.startsWith('redis:')) {
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

// Stop all other processes except current
async function StopOther (service, process, processId)
{
  var CamundaUrl = service.taskService.api.baseUrl;
  var authCamunda = {
      username: 'camunda',
      password: caPass
  };
  const response = await axios.get( CamundaUrl + '/process-instance?processDefinitionKey=' + process, {httpAgent: httpagent, httpsAgent: httpsagent, timeout: 20000, auth: authCamunda});
  var response2;
  var ids = [];
  if (response.data) {
    for ( var i = 0; i < response.data.length; i++) {
      if (response.data[i].id !== processId) {
        ids.push (response.data[i].id);
      }
    }
    if (ids.length > 0) {
      var deldata = {'processInstanceIds': ids, 'failIfNotExists': false};
      response2 = await axios.post( CamundaUrl + '/process-instance/delete', deldata, {httpAgent: httpagent, httpsAgent: httpsagent, timeout: 20000, auth: authCamunda});
      logger.log({level: 'info', message: {type: 'PROCESSES.STOPED', processes: ids, sequenceId: service.sequenceId}});
    }
  }
}

function genPassword (len) {
  var result           = '';
  var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var charactersLength = characters.length;

  for (var i=0; i < len; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

module.exports = {InternalServiceCore};
