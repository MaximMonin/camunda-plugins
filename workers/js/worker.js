'use strict';

const { InternalService }  = require ('./InternalService.js');

class Worker {
  constructor(redis, mailer) {
    this.redis = redis;
    this.mailer = mailer;
  }
  router(task, taskService)
  {
    const { topicName, processDefinitionKey } = task;
    switch (topicName) {
      case 'InternalService':
        InternalService(task, taskService, this);
        break;
      default:
      {
        console.log('Unknown service ' + topicName + ' in Process ' + processDefinitionKey);
        taskService.handleFailure(task, {
          errorMessage: 'Unknown service ' + topicName + ' in Process ' + processDefinitionKey,
          errorDetails: '',
          retries: 0
        });
      }
    }
  }
}

module.exports = { Worker };
