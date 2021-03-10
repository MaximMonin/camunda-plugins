const { Variables } = require('camunda-external-task-client-js');
const { v4: uuidv4 } = require('uuid');
const { InternalServiceCore } = require ('./InternalServiceCore.js');

const redisCacheHours = process.env.redisCacheHours || 1;

function InternalService (task, taskService, redis)
{
  const { processDefinitionKey, activityId } = task;

  var method = task.variables.get('method');

  if (method && method !== '')
  {
    try {
      var service = new InternalServiceCore (task, taskService, method, redis);

      if (service.checkmethod() == false)
      {
        console.log('Unknown method ' + method + ' (' + processDefinitionKey + ', ' + activityId + ')');
        taskService.handleFailure(task, {
          errorMessage: 'Unknown method ' + method + ' (' + processDefinitionKey + ', ' + activityId + ')',
          errorDetails: '',
          retries: 0
        });
        return;
      }
      var checkpar = service.checkparams ();
      if (checkpar !== '')
      {
        console.log('Error params: ' + checkpar + ' (' + processDefinitionKey + ', ' + activityId + ')');
        taskService.handleFailure(task, {
          errorMessage: 'Error params: ' + checkpar + ' (' + processDefinitionKey + ', ' + activityId + ')',
          errorDetails: '',
          retries: 0
        });
        return;
      }
      service.executeRequest (handleCallback);
    }
    catch (e) {
      taskService.handleFailure(task, {
        errorMessage: 'Unknown error: ' + JSON.stringify(e) + ' (' + processDefinitionKey + ', ' + activityId + ')',
        errorDetails: '',
        retries: 0
      });
    }
    return;
  }
  else {
    switch (activityId) {
    default:
      {
        console.log('Unknown activityId in process ' + processDefinitionKey + ' (' + activityId + ')');
        taskService.handleFailure(task, {
          errorMessage: 'Unknown activityId in process ' + processDefinitionKey + ' (' + activityId + ')',
          errorDetails: '',
          retries: 0
        });
      }
    }
  }
}

function handleCallback (service, data)
{
  const processVariables = new Variables();
  const localVariables = new Variables();

  var defaulthandler = service.taskService.error;
  var result;
  service.taskService.error = handleError;
  if (data.result || data.result === 0) {
    // Special rules for returning specific data
    if (service.resultReturn) {
      if (service.resultReturn == 'json' || service.resultReturn == 'string') {
        if (service.resultReturn == 'string') {
          result = JSON.stringify(data.result);
        }
        else {
          result = data.result;
        }
      } else {
        result = data.result[service.resultReturn];
      }
      // Redis caching to reduce variable size and camunda db size
      if (service.useRedisCache && ! result.includes('redis:')) {
        var key = uuidv4();
        service.redis.set ( key, result, redisCacheHours * 3600, function(err, res) {
          // return redis-key instead data
          if (res) {
            localVariables.set('result', 'redis:' + key);
            service.taskService.complete(service.task, processVariables, localVariables);
          }
          else {
            console.log (err);
            localVariables.set('result', result);
            service.taskService.complete(service.task, processVariables, localVariables);
          }
        });
        return;
      }
      localVariables.set('result', result);
    }
    service.taskService.complete(service.task, processVariables, localVariables);
  }
  else if (data.lock) {
    processVariables.set('lock', JSON.stringify(data.lock));
    service.taskService.complete(service.task, processVariables, localVariables);
  }
  else if (data.error) {
    if (service.ignoreErrors != []) {
      for (var i=0; i < service.ignoreErrors.length; i++)
      {
        if (JSON.stringify(data.error).includes (service.ignoreErrors[i])) {
          data.result = {};
          if (service.resultReturn) {
             localVariables.set('result', JSON.stringify(data.result));
          }
          service.taskService.complete(service.task, processVariables, localVariables);
          return;
        }
      }
    }
    var error = JSON.stringify(data.error);
    if (error.length > 4000) {
      error = 'error message too long';
    }
    if (service.resultReturn) {
      processVariables.set('result', error);
    }
    service.taskService.handleBpmnError(service.task, service.method + '-error', error, processVariables);
  }
  else {
    service.taskService.handleFailure(service.task, { retries: 1, retryTimeout: 1000 });
  }

  // When Commiting Error or Complete can be Optimistic Locking error.
  // We are repeating this operation to continue process
  // Else engine will rollback transaction and process can stop for 30 seconds
  function handleError (event, task, e)
  {
//    console.log (e);
    if (service.maxErrors <= 0) {
      service.taskService.error = defaulthandler;
      service.taskService.error (event, task, e);
      return;
    }
    service.maxErrors = service.maxErrors - 1;

    console.log ('Trying to repeat transaction commit...');
    if (event == 'complete') {
      service.taskService.complete(service.task, processVariables, localVariables);
    }
    if (event == 'handleFailure') {
      service.taskService.handleFailure(service.task, { retries: 1, retryTimeout: 1000 });
    }
    if (event == 'handleBpmnError') {
      service.taskService.handleBpmnError(service.task, service.method + '-error', JSON.stringify(data.error), processVariables);
    }
  }
}

module.exports = {InternalService};
