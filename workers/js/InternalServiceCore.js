'use strict';

const { Variables } = require('camunda-external-task-client-js');
const { excelCreate } = require ('./excel.js');
const { encrypt, decrypt, certificateData } = require ('./crypto.js');
const http = require ('http');
const https = require ('https');
const httpagent = new http.Agent({ keepAlive: true });
const httpsagent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });
const axios = require ('axios'); axios.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest';
const fs = require('fs');
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

// Filter large data
const ignorePrivate = format((info) => {
  let data = info.message;
  try {
    if (data.params.data) {
      data.params.data = 'data...(omited)';
    }
    if (data.params.certificate) {
      data.params.certificate = 'certificate...(omited)';
    }
    if (data.params.text) {
      data.params.text = 'text...(omited)';
    }
  }
  catch {
  }
  return info;
});

const consoleLogFormat = format.printf(info => `${info.level} ${info.timestamp} ${JSON.stringify(info.message || {})}`);
const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    ignorePrivate(),
    format.json()
  ),
  defaultMeta: { service: 'InternalService' },
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize(),
        consoleLogFormat
      )
    }),
    transport,
    transportErr,
  ],
});

const ServiceRules = [
  // Special method to do nothing, just return back. Useful for engine test
  { custom: true, method: 'null', rules: ''},
  // Remove local file
  { custom: true, method: 'file.Remove', rules: 'file', ignoreErrors: ['no such file or directory']},
  // Read local file
  { custom: true, method: 'file.Read', rules: 'file', resultReturn: 'data', useRedisCache: true},

  // Special methods for locking and unlocking resource
  // Queries to redis cluster
  { method: 'resource.Lock', rules: '', timeout: 600},
  { method: 'resource.Unlock', rules: ''},

  // Add rows to temp table
  { custom: true, method: 'table.AddRows', rules: 'table,data'},
  // Check number of records in temp table
  { custom: true, method: 'table.Count', rules: 'table', resultReturn: 'data'},
  // Read data from temp table and form single array
  { custom: true, method: 'table.Read', rules: 'table', resultReturn: 'data', useRedisCache: true},
  // Read data from redis cache and return native json data
  { custom: true, method: 'cache.Read', rules: 'data,conversion', resultReturn: 'data'},
  // Read data from redis cache and return bool value if data exists
  { custom: true, method: 'cache.Exists', rules: 'data', resultReturn: 'data'},
  // Write data to redis cache to a key
  { custom: true, method: 'cache.Write', rules: 'data,key'},
  // write array of data tables to excel file
  { custom: true, method: 'excel.Create', rules: 'sheets,data', resultReturn: 'data', useRedisCache: true},

  // get enviroment variables for current server
  { custom: true, method: 'environment.Get', rules: '', resultReturn: 'env'},
  // stop all other processes of this type of process except current process
  { custom: true, method: 'processes.StopOther', rules: '' },

  // Send message to telegram
  { method: 'telegram', rules: 'chat_id,parse_mode', url: 'https://api.telegram.org/bot' + telegramBot + '/sendMessage'},
  // Send file to telegram
  { method: 'telegram.File', rules: 'chat_id,filename,data', url: 'https://api.telegram.org/bot' + telegramBot + '/sendDocument'},
  // Send email, check https://nodemailer.com/message/ for message format and other fields description
  // attachment file contents can be reference to redis cache file object
  { custom: true, method: 'email', rules: 'to,subject'},

  // generatePassword
  { custom: true, method: 'generatePassword', rules: 'length', resultReturn: 'data', useRedisCache: true},
  // encrypt/decrypt sensetive data like passwords
  { custom: true, method: 'encrypt', rules: 'text,key', resultReturn: 'data', useRedisCache: true},
  { custom: true, method: 'decrypt', rules: 'text,key', resultReturn: 'data', useRedisCache: true},
  // extract cetrificate data from certificate
  { custom: true, method: 'certificateData', rules: 'certificate', resultReturn: 'data'},
  // joins chunks into single array
  { custom: true, method: 'joinChunks', rules: 'chunks', resultReturn: 'data', useRedisCache: true},
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
    this.processVariables = new Variables();
    this.localVariables = new Variables();
    this.error = '';
    this.timeoutRepeat = true;
    this.custom = false;

    try {
      let params = task.variables.get('params');
      if (params) {
        if (typeof params == 'string') {
          params = JSON.parse(params);
        }
        this.params = params;
      }
    }
    catch {
    }

    for(let i=0; i < ServiceRules.length; i++) {
      if (ServiceRules[i].method == method){
        if (ServiceRules[i].ignoreErrors) {
          this.ignoreErrors = ServiceRules[i].ignoreErrors;
        }
        if (ServiceRules[i].resultReturn) {
          this.resultReturn = ServiceRules[i].resultReturn;
        }
        if (ServiceRules[i].useRedisCache) {
          this.useRedisCache = ServiceRules[i].useRedisCache;
        }
        if (ServiceRules[i].timeout) {
          this.timeout = ServiceRules[i].timeout;
        }
        if (ServiceRules[i].url) {
          this.url = ServiceRules[i].url;
        }
        if (ServiceRules[i].timeoutRepeat === false) {
          this.timeoutRepeat = ServiceRules[i].timeoutRepeat;
        }
        if (ServiceRules[i].custom) {
          this.custom = ServiceRules[i].custom;
        }
      }
    }

    try {
      let tasktimeout = task.variables.get('timeout');
      if (tasktimeout) {
        this.timeout = tasktimeout;
      }
      if (this.params['timeout']) {
        this.timeout = this.params['timeout'];
      }
    }
    catch {
    }
    try {
      let taskurl = task.variables.get('url');
      if (taskurl) {
        this.url = taskurl;
      }
      if (this.params['url']) {
        this.url = this.params['url'];
      }
    }
    catch {
    }
    try {
      let useRedisCache = task.variables.get('useRedisCache');
      if (useRedisCache) {
        this.useRedisCache = JSON.parse(useRedisCache);
      }
    }
    catch {
    }
  }

  // Check method available
  checkmethod ()
  {
    for(let i=0; i < ServiceRules.length; i++) {
      if (ServiceRules[i].method == this.method) {
        return true;
      }
    }
    return false;
  }

  // Check required params list
  checkparams ()
  {
    let rules;
    let rule;
    for(let i=0; i < ServiceRules.length; i++) {
      if (ServiceRules[i].method == this.method) {
       rules = ServiceRules[i].rules.split(',');
      }
    }

    for(let i=0; i < rules.length; i++) {
      rule = rules[i];
      if (rule == '') {
        continue;
      }
      if (rule.includes('.')) {
        let parts = rule.split('.');
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
    let begintime = Date.now();
    let id = uuidv4();
    let sequenceId = this.sequenceId;
    let service = this;
    let params;

    // Extend Camunda Lock for current task to timeout value if needed
    if (Date.now() + service.timeout * 1000 - new Date(service.task.lockExpirationTime) > 0) {
      if (! await lockTask (service, service.timeout * 1000)) {
        callback (service, 'Repeat again later');
        return;
      }
    }
    try { params = JSON.parse(JSON.stringify(service.params)); } catch {}

    if (service.custom) {
      logger.log({level: 'info', message: {type: 'CUSTOM', id: id, process: service.task.processDefinitionKey, method: service.method, params: params, sequenceId: sequenceId}});
      executeCustomRequest (service, function(service, data) {
        service.responsetime = Date.now() - begintime;
        if (data.error) {
          console.log(data.error);
          logger.log({level: 'error', message: {type: 'CUSTOM-ERROR', id: id, process: service.task.processDefinitionKey, method: service.method, error: data.error, responsetime: service.responsetime, sequenceId: sequenceId}});
        }
        if (data.result) {
          logger.log({level: 'info', message: {type: 'CUSTOM-DONE', id: id, process: service.task.processDefinitionKey, method: service.method, /* result: data.result, */ responsetime: service.responsetime, sequenceId: sequenceId}});
        }

        callback (service, data);
      });
      return;
    }

    // Special methods for locking and unlocking resource
    if (this.method == 'resource.Lock') {
      let lockResource = 'lock';
      if (this.params.key) {
        lockResource = lockResource + ':' + this.params.key;
      }
      logger.log({level: 'info', message: {type: 'LOCK', id: id, process: service.task.processDefinitionKey, method: service.method, resource: lockResource, timeout: service.timeout, sequenceId: sequenceId}});
      this.redis.redlock.lock(lockResource, service.timeout * 1000, function(err, lock) {
        service.responsetime = Date.now() - begintime;
        if (err) {
          logger.log({level: 'info', message: {type: 'CANTLOCK', id: id, process: service.task.processDefinitionKey, method: service.method, resource: lockResource, timeout: service.timeout, responsetime: service.responsetime, sequenceId: sequenceId}});
          callback (service, 'Repeat again later');
          return;
        }

        logger.log({level: 'info', message: {type: 'LOCKED', id: id, process: service.task.processDefinitionKey, method: service.method, resource: lockResource, timeout: service.timeout, responsetime: service.responsetime, sequenceId: sequenceId}});
        let lockkey = {resource: lockResource, timeout: service.timeout, value: lock.value};
        callback (service, {lock: lockkey});
      });
      return;
    }
    if (this.method == 'resource.Unlock') {
      try {
        let lockkey = JSON.parse(this.task.variables.get('lock'));
        logger.log({level: 'info', message: {type: 'UNLOCK', id: id, process: service.task.processDefinitionKey, method: service.method, resource: lockkey.resource, sequenceId: sequenceId}});
        let lock = new Redlock.Lock(this.redis.redlock, lockkey.resource, lockkey.value, lockkey.timeout * 1000);
        lock.unlock(function(err) {
          service.responsetime = Date.now() - begintime;
          if (err) {
            console.log (err);
            logger.log({level: 'info', message: {type: 'CANTUNLOCK', id: id, process: service.task.processDefinitionKey, method: service.method, resource: lockkey.resource, responsetime: service.responsetime, sequenceId: sequenceId}});
          }
          else {
            logger.log({level: 'info', message: {type: 'UNLOCKED', id: id, process: service.task.processDefinitionKey, method: service.method, resource: lockkey.resource, responsetime: service.responsetime, sequenceId: sequenceId}});
          }
          callback (service, {result: {}});
        });
      }
      catch (e) {
        callback (service, {result: {}});
      }
      return;
    }

    // send message to telegram or sendDocument to telegram
    let data = service.params;
    try {
      if (data && data.data && data.data.startsWith('redis:')) {
        let key = data.data.substring(6);
        data.data = await service.redis.getAsync (key);
      }
    }
    catch (e) {
      console.log (e);
    }

    let url = service.url;
    if (this.method == 'telegram') {
      let text = encodeURI(this.task.variables.get('message'));
      url = url + '?text=' + text;
      url = url.replace(/#/g, '%23');
    }

    let headers = {'Content-Type': 'application/json', 'Accept': 'application/json'};
    if (this.method == 'telegram.File') {
      const formData = new FormData();
      formData.append('document', Buffer.from(data.data, 'base64'), data.filename);
      headers = formData.getHeaders();
      url = url + '?chat_id=' + data.chat_id;
      data = formData;
    }

    logger.log({level: 'info', message: {type: 'REQUEST', id: id, process: service.task.processDefinitionKey, method: service.method, params: params, sequenceId: sequenceId}});

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
      let result = response.data;
      let logresult;
      try {
        logresult = JSON.parse(JSON.stringify(result));
        if (logresult.result && logresult.result.data) {
          logresult.result.data = 'result data...(omited)';
        }
      }
      catch {}
      logger.log({level: 'info', message: {type: 'RESPONSE', id: id, process: service.task.processDefinitionKey, method: service.method, result: logresult, responsetime: service.responsetime, sequenceId: sequenceId}});

      callback (service, result);
    })
    .catch(function (error) {
      service.responsetime = Date.now() - begintime;
      let errdata;
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

      let retries = 2;
      if (service.task.retries) { // default value == null
        retries = service.task.retries - 1;
      }
      // max 3 attempts repeating request timeout
      if (service.timeoutRepeat && typeof errdata == 'string' && errdata.includes('Service request timeout:') && retries > 0 ) {
        callback (service, {timeout: {message: 'Repeat again (timeout occurs)', retries: retries }});
        return;
      }

      callback (service, {error: errdata});
    });
  }
}

async function executeCustomRequest (service, callback) {
  try {
    if (service.method == 'null') {
      callback (service, {result: {}});
      return;
    }
    if (service.method == 'file.Remove') {
      fs.unlinkSync(service.params.file);
      callback (service, {result: {}});
      return;
    }
    if (service.method == 'file.Read') {
      let data = fs.readFileSync(service.params.file);
      callback (service, {result: {data: data.toString('base64')}});
      return;
    }
    if (service.method == 'table.AddRows') {
      await tableAddRows(service);
      callback (service, {result: {}});
      return;
    }
    if (service.method == 'table.Count') {
      service.redis.llen(service.params.table, function(err, data) {
        if (err) {
          callback (service, {error: err});
          return;
        }
        callback (service, {result: {data: data}});
      });
      return;
    }
    if (service.method == 'table.Read') {
      let data = await tableRead(service);
      callback (service, {result: {data: data}});
      return;
    }
    if (service.method == 'cache.Read') {
      let data = await cacheRead(service);
      callback (service, {result: {data: data}});
      return;
    }
    if (service.method == 'cache.Exists') {
      let data = await cacheExists(service);
      callback (service, {result: {data: data}});
      return;
    }
    if (service.method == 'cache.Write') {
      await cacheWrite(service);
      callback (service, {result: {}});
      return;
    }
    if (service.method == 'excel.Create') {
      let data = await excelCreate(service, service.params.sheets, service.params.data);
      callback (service, {result: {data: data}});
      return;
    }
    if (service.method == 'environment.Get') {
      try {
        callback (service, {result: {env: {server: process.env.SERVER, env: process.env.ENVIRONMENT}}});
      }
      catch (e) {
        callback (service, {result: {env: {server: 'SERVERNotDefined', env: 'ENVIRONMENTNotDefined'}}});
      }
      return;
    }
    if (service.method == 'generatePassword') {
      callback (service, {result: {data: genPassword (service.params.length)}});
      return;
    }
    if (service.method == 'encrypt') {
      let data = await encryptText(service);
      callback (service, {result: {data: data}});
      return;
    }
    if (service.method == 'decrypt') {
      let data = await decryptText(service);
      callback (service, {result: {data: data}});
      return;
    }
    if (service.method == 'certificateData') {
      let data = await getCertificateData(service);
      callback (service, {result: {data: data}});
      return;
    }
    if (service.method == 'joinChunks') {
      let data = await joinChunks(service);
      callback (service, {result: {data: data}});
      return;
    }
    if (service.method == 'email') {
      email(service, callback);
      return;
    }
    if (service.method == 'processes.StopOther') {
      stopOther(service, service.task.processDefinitionKey, service.processId, callback);
      return;
    }
  }
  catch (error) {
    callback (service, {error: error.message});
    return;
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

// Add data rows to table, by using Redis rpush
async function tableAddRows (service) {
  for (let i=0; i < service.params.data.length; i++) {
    let data = service.params.data[i];
    if (typeof data == 'string' && data.startsWith('redis:')) {
      let key = data.substring(6);
      data = await service.redis.getAsync(key);
      if (typeof data == 'string') {
        data = JSON.parse(data);
      }
    }
    await service.redis.rpushAsync(service.params.table, JSON.stringify(data));
  }
  await service.redis.expireAsync(service.params.table, redisCacheHours * 3600);
}

// Read all table rows, by using Redis lrange
async function tableRead (service) {
  let data = [];
  let items = await service.redis.lrangeAsync (service.params.table);
  items.forEach((item) => {
    data.push(JSON.parse(item));
  });
  return data;
}

// Read data from redis cache and return data object
async function cacheRead (service) {
  let data = service.params.data;
  if (typeof data == 'string' && data.startsWith('redis:')) {
    let key = data.substring(6);
    data = await service.redis.getAsync (key);
  }
  if (service.params.conversion.includes ('base64')) {
    data = Buffer.from(data, 'base64').toString();
  }
  if (service.params.conversion.includes ('json')) {
    data = JSON.parse(data);
  }
  return data;
}

// Read data from redis cache and return if data object exists
async function cacheExists (service) {
  let data = service.params.data;
  if (typeof data == 'string' && data.startsWith('redis:')) {
    let key = data.substring(6);
    data = await service.redis.getAsync (key);
  }
  return (data !== null);
}

// Write data to redis cache
async function cacheWrite (service) {
  let data = service.params.data;
  if (typeof data == 'string' && data.startsWith('redis:')) {
    let key = data.substring(6);
    data = await service.redis.getAsync (key);
    if (typeof data == 'string') {
      try {
        let tempdata = JSON.parse(data);
        data = tempdata;
      }
      catch {}
    }
  }
  let key = service.params.key;
  let ttl = redisCacheHours * 3600;
  if (service.params.ttl) {
    ttl = service.params.ttl;
  }
  if (typeof data != 'string') {
    await service.redis.setAsync(key, JSON.stringify(data), ttl);
  } else {
    await service.redis.setAsync(key, data, ttl);
  }
}

// encrypt text with a key and secret
async function encryptText (service) {
  let data = service.params.text;
  if (typeof data == 'string' && data.startsWith('redis:')) {
    let key = data.substring(6);
    data = await service.redis.getAsync (key);
  }
  data = encrypt (data, service.params.key);
  return data;
}

// decrypt text with a key and secret
async function decryptText (service) {
  let data = service.params.text;
  if (typeof data == 'string' && data.startsWith('redis:')) {
    let key = data.substring(6);
    data = await service.redis.getAsync (key);
  }
  data = decrypt (data, service.params.key);
  return data;
}

// extract certificate data from certificate
async function getCertificateData (service) {
  let data = service.params.certificate;
  if (typeof data == 'string' && data.startsWith('redis:')) {
    let key = data.substring(6);
    data = await service.redis.getAsync (key);
  }
  if (service.params.conversion && service.params.conversion.includes ('base64')) {
    data = Buffer.from(data, 'base64').toString();
  }
  return certificateData (data);
}

function genPassword (len) {
  let result           = '';
  let characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let charactersLength = characters.length;

  for (let i=0; i < len; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

// join chunk arrays into single array
async function joinChunks (service) {
  let chunks = service.params.chunks;
  let result = [];
  for (let i=0; i < chunks.length; i++) {
    let item = chunks[i];
    if (typeof item == 'string' && item.startsWith('redis:')) {
      let key = item.substring(6);
      item = await service.redis.getAsync (key);
      item = JSON.parse (item);
    }
    for (let j=0; j<item.length; j++) {
      result.push(item[j]);
    }
  }
  return result;
}

// send email
async function email (service, callback) {
  // Replace file attachments[] as links to redis cache files
  if (service.params.attachments) {
    for (let j=0; j < service.params.attachments.length; j++) {
      let attachment = service.params.attachments[j];
      if (attachment.content && typeof attachment.content == 'string' && attachment.content.startsWith('redis:')) {
        attachment.content = await service.redis.getAsync (attachment.content.substring(6));
        attachment['encoding'] = 'base64';
      }
    }
  }
  service.mailer.sendMail(service.params, (error) => {
    if (error) {
      callback (service, {error: error.message});
      return;
    }
    callback (service, {result: {}});
  });
}

// Stop all other processes except current
async function stopOther (service, process, processId, callback)
{
  const CamundaUrl = service.taskService.api.baseUrl;
  const authCamunda = {
      username: 'camunda',
      password: caPass
  };
  try {
    const response = await axios.get( CamundaUrl + '/process-instance?processDefinitionKey=' + process, {httpAgent: httpagent, httpsAgent: httpsagent, timeout: 20000, auth: authCamunda});
    let ids = [];
    if (response.data) {
      for (let i = 0; i < response.data.length; i++) {
        if (response.data[i].id !== processId) {
          ids.push (response.data[i].id);
        }
      }
      if (ids.length > 0) {
        let deldata = {'processInstanceIds': ids, 'failIfNotExists': false};
        await axios.post( CamundaUrl + '/process-instance/delete', deldata, {httpAgent: httpagent, httpsAgent: httpsagent, timeout: 20000, auth: authCamunda});
      }
    }
    callback (service, {result: {}});
  }
  catch (error) {
    let errdata;
    if (error.response) {
      errdata = error.response.data;
    }
    else if (error.request) {
      errdata = 'Service request timeout: ' + service.taskService.api.baseUrl;
    }
    else {
      errdata = error.message;
    }
    callback (service, {error: errdata});
  }
}

module.exports = {InternalServiceCore};
